// The whole correction cycle in one call: split the cases, measure, check the instrument, find why cases fail, try
// changes, and confirm the best one on cases no proposal has seen. Each step existed as its own command; a person had
// to chain them and make the calls in between (which candidates to combine, when to stop, how to confirm).
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { clusterFailures, summarise } from "../analysis/cluster";
import { induceTaxonomy } from "../analysis/taxonomy";
import { Cache } from "../core/cache";
import { type HoneConfig, loadCases } from "../core/config";
import { Store } from "../core/store";
import type { Trial } from "../core/types";
import { offlineEmbed } from "../providers/embed";
import { compareTargets, mcnemarExact } from "../stats/paired";
import { pairedPowerN } from "../stats/power";
import { type RunOutcome, runConfig } from "./ablation";
import { type ChatFn, parseProposal, REFLECT_SYSTEM } from "./evolve";

export type SharpenVerdict = "proven" | "promising" | "no gain" | "nothing to sharpen" | "nothing to change" | "cannot measure";

/** One entry of the ledger: a change that was tried, why, and what came of it. */
export interface SharpenCandidate {
  id: string;
  kind: "variant" | "text";
  parent: string;
  variant?: string;
  text?: string;
  rationale?: string;
  /** The quick check on the parent's failing cases plus a few passing ones. */
  sample?: { cases: number; candidate: number; parent: number };
  /** Pass rate on the dev cases; absent when the candidate was dropped before a full run. */
  dev?: number;
  costUsd: number;
  dropped?: "sample" | "unparseable";
  runId?: string;
}

export interface SharpenResult {
  id: string;
  split: { dev: string[]; holdout: string[]; inSample: boolean };
  baseline: { dev: number; trials: number; errors: number; costUsd: number; runId: string };
  diagnosis: { code: string; definition: string; size: number; example: string }[];
  candidates: SharpenCandidate[];
  /** The best candidate against the baseline on the confirmation cases (held out, or the dev cases when nothing could be held out). */
  best?: { id: string; label: string; cases: number; baseline: number; candidate: number; diff: number; lo: number; hi: number; p: number; costRatio?: number; needed?: number };
  verdict: SharpenVerdict;
  stopped: "gate" | "budget" | "maxCost" | "until" | "exhausted";
  message: string;
  path: string;
}

export interface SharpenOptions {
  config: HoneConfig;
  hash: string;
  cwd: string;
  /** Names the failure modes and writes rewrites. Without it only declared variants are tried. */
  chat?: ChatFn;
  /** Candidates to try (default 6). */
  budget?: number;
  /** Share of cases kept away from every proposal for the final check (default 1/3). */
  holdout?: number;
  trials?: number;
  maxCost?: number;
  /** Stop proposing once the best dev pass rate reaches this. */
  until?: number;
  alpha?: number;
  seed?: number;
  useCache?: boolean;
  log?: (s: string) => void;
}

/**
 * Hold out a share of the cases, chosen by a hash of the seed and the id so the split is the same on every run.
 * Cases that declare the same `cluster` (two phrasings of one question, say) go to the same side: a held-out case
 * whose twin was seen by a proposal is not unseen.
 */
export function splitCases(cases: (string | { id: string; cluster?: string })[], holdout = 1 / 3, seed = 1): SharpenResult["split"] {
  const items = cases.map((c) => (typeof c === "string" ? { id: c, group: c } : { id: c.id, group: c.cluster ?? c.id }));
  const ids = items.map((c) => c.id);
  const n = Math.ceil(ids.length * holdout);
  const key = (group: string): string => createHash("sha256").update(`${seed}:${group}`).digest("hex");
  const held = new Set<string>();
  let count = 0;
  for (const group of [...new Set(items.map((c) => c.group))].sort((x, y) => key(x).localeCompare(key(y)))) {
    if (count >= n) break;
    held.add(group);
    count += items.filter((c) => c.group === group).length;
  }
  if (ids.length < 12 || n < 4 || count >= ids.length) return { dev: ids, holdout: [], inSample: true };
  return { dev: items.filter((c) => !held.has(c.group)).map((c) => c.id), holdout: items.filter((c) => held.has(c.group)).map((c) => c.id), inSample: false };
}

interface Member {
  id: string;
  variant?: string;
  text?: string;
  run: RunOutcome;
}

const rate = (r: RunOutcome, cases: string[]): number => cases.reduce((s, c) => s + (r.perCase.get(c) ?? 0), 0) / Math.max(1, cases.length);
const failing = (r: RunOutcome, cases: string[]): string[] => cases.filter((c) => (r.perCase.get(c) ?? 0) < 1);

/** Up to n failed trials taken round-robin across failure clusters, so one loud failure mode does not crowd out the rest. */
async function spread(trials: Trial[], n: number, seed: number): Promise<Trial[]> {
  const failed = trials.filter((t) => t.pass === false);
  if (failed.length <= n) return failed;
  const { clusters } = await clusterFailures(failed, { embed: offlineEmbed, seed });
  const byId = new Map(failed.map((t) => [t.id, t]));
  const queues = clusters.map((c) => [c.representative, ...c.trialIds.filter((i) => i !== c.representative)]);
  const out: Trial[] = [];
  for (let i = 0; out.length < n && queues.some((q) => q.length > 0); i++) {
    const next = queues[i % queues.length]!.shift();
    if (next) out.push(byId.get(next)!);
  }
  return out;
}

async function diagnose(trials: Trial[], chat: ChatFn | undefined, seed: number): Promise<SharpenResult["diagnosis"]> {
  const failed = trials.filter((t) => t.pass === false);
  const { clusters } = await clusterFailures(failed, { embed: offlineEmbed, seed });
  const caseOf = new Map(failed.map((t) => [t.id, t.trace.caseId]));
  const out: SharpenResult["diagnosis"] = [];
  for (const c of clusters) {
    const named = chat ? (await induceTaxonomy([c], { chat }))[0] : undefined;
    const code = named?.code ?? c.id;
    const same = out.find((o) => o.code === code); // two clusters the model gave one name are one failure mode
    if (same) same.size += c.size;
    else out.push({ code, definition: named?.definition ?? `common words: ${c.topTerms.join(", ")}`, size: c.size, example: caseOf.get(c.representative) ?? "" });
  }
  return out.sort((a, b) => b.size - a.size);
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const pts = (x: number): string => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
// the account stays readable; the ledger file keeps the full text
const clip = (text: string, n: number): string => (text.length > n ? `${text.slice(0, n - 3).trimEnd()}...` : text);

/** The plain account: what is, why it fails, what was tried, and what is proven. Statistics come second, in parentheses. */
function describe(r: Omit<SharpenResult, "message" | "path">, x: { cwd: string; alpha: number; error?: string; textFile?: string; noKey: boolean }): string {
  const n = r.split.dev.length;
  if (r.verdict === "cannot measure") return `Cannot measure: the system failed to run in ${r.baseline.errors} of ${r.baseline.trials} trials (first error: ${x.error ?? "unknown"}). Fix that first; an error is not a wrong answer.\n`;
  if (r.verdict === "nothing to sharpen") return `Nothing to sharpen: all ${n} cases pass. Add harder cases.\n`;
  const lines = [`Now: ${pct(r.baseline.dev)} of ${n} cases pass. ${r.split.inSample ? "Too few cases to hold any out, so the final check uses the cases it learned from." : `${r.split.holdout.length} more cases are held out for the final check.`}`];
  if (r.diagnosis.length) {
    const failed = r.diagnosis.reduce((s, d) => s + d.size, 0);
    lines.push("Why it fails:", ...r.diagnosis.map((d, i) => `  ${i + 1}. ${d.code} (${d.size} of ${failed} failed trials, e.g. ${d.example}): ${clip(d.definition, 110)}`));
  }
  if (r.verdict === "nothing to change") {
    lines.push(
      x.noKey
        ? "Nothing to change: sharpen.text is declared, but there is no LLM key to write rewrites with (ANTHROPIC_API_KEY or OPENAI_API_KEY)."
        : "Nothing to change: hone.config.ts declares nothing hone may change. Add `sharpen: { text: { seed, apply } }` for a prompt or a rule text, or `sharpen: { variants: { name: (config) => config } }` for settings.",
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push(`Tried ${plural(r.candidates.length, "change")}:`);
  const width = Math.max(0, ...r.candidates.map((c) => c.id.length)) + 2;
  for (const c of r.candidates) {
    const what = c.dropped === "unparseable" ? "dropped: the model's reply was not usable" : c.dropped === "sample" ? `dropped early: ${pct(c.sample!.candidate)} against ${pct(c.sample!.parent)} on a sample` : `${pct(r.baseline.dev)} -> ${pct(c.dev ?? 0)}${c.rationale ? `   ${clip(c.rationale, 90)}` : ""}`;
    lines.push(`  ${c.dev !== undefined && c.dev > r.baseline.dev ? "+" : "-"} ${c.id.padEnd(width)}${what}`);
  }
  const b = r.best;
  if (!b) lines.push(`Result: NO GAIN. ${r.candidates.length === 0 ? "Nothing was tried." : r.candidates.length === 1 ? "The one change tried did not beat what you have." : `None of the ${r.candidates.length} changes beat what you have.`}`);
  else if (r.verdict === "no gain") {
    const dev = r.candidates.find((c) => c.id === b.id)?.dev ?? 0;
    lines.push(`Result: NO GAIN. ${b.label} looked better on the cases it learned from (${pct(r.baseline.dev)} -> ${pct(dev)}) but not on ${b.cases} cases it never saw (${pct(b.baseline)} -> ${pct(b.candidate)}). Keep what you have.`);
  } else {
    const where = r.split.inSample ? `On the ${b.cases} cases it learned from` : `On ${b.cases} cases it never saw`;
    const stats = `(${pts(b.diff)} points, ${Math.round((1 - x.alpha) * 100)}% interval ${pts(b.lo)} to ${pts(b.hi)}, ${b.p < 0.001 ? "p < 0.001" : `p = ${b.p.toFixed(b.p < 0.01 ? 3 : 2)}`}).`;
    const cost = b.costRatio !== undefined ? ` Cost per case: ${b.costRatio.toFixed(1)}x.` : "";
    const more = r.verdict === "proven" ? "" : `${b.needed ? ` About ${b.needed} held-out cases would settle it.` : ""}${r.split.inSample ? " Add cases (18 or more) so that at least six can be held out." : ""}`;
    lines.push(`Result: ${r.verdict === "proven" ? "PROVEN" : "PROMISING, not proven"}. ${where}, ${b.label} takes the pass rate from ${pct(b.baseline)} to ${pct(b.candidate)}`, `${stats}${cost}${more}`);
    if (x.textFile) lines.push(`The new text is in ${path.relative(x.cwd, x.textFile)}`);
    const variant = r.candidates.find((c) => c.id === b.id)?.variant;
    if (variant) lines.push(`It uses the variant "${variant}" from sharpen.variants.`);
  }
  if (x.noKey) lines.push("No LLM key (ANTHROPIC_API_KEY or OPENAI_API_KEY): rewrites of sharpen.text were not tried and the failure groups are unnamed.");
  return `${lines.join("\n")}\n`;
}

export async function sharpen(opts: SharpenOptions): Promise<SharpenResult> {
  const { config } = opts;
  const budget = opts.budget ?? 6;
  const alpha = opts.alpha ?? 0.05;
  const seed = opts.seed ?? 1;
  const textHook = config.sharpen?.text;
  const variants = config.sharpen?.variants ?? {};
  const canRewrite = Boolean(textHook && opts.chat);
  const root = path.resolve(opts.cwd, config.cacheDir ?? ".hone");
  const store = new Store(root);
  const cache = new Cache(path.join(root, "cache"));
  const deps = { cwd: opts.cwd, store, cache, hash: opts.hash, trials: opts.trials, useCache: opts.useCache ?? true, log: opts.log };
  const id = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  try {
    const allCases = await loadCases(config.cases, opts.cwd);
    const split = splitCases(allCases, opts.holdout, seed);
    const groupOf = new Map(allCases.map((c) => [c.id, c.cluster ?? c.id]));
    const build = (m: { variant?: string; text?: string }): HoneConfig => {
      const c = m.variant ? variants[m.variant]!(config) : config;
      return textHook && m.text !== undefined ? textHook.apply(c, m.text) : c;
    };
    const run = (m: { variant?: string; text?: string }, label: string, caseIds: string[]): Promise<RunOutcome> => runConfig(build(m), label, { ...deps, caseIds });
    const cost = (r: RunOutcome): number => r.summary.totals.costUsd;

    const base: Member = { id: "baseline", run: await run({}, "baseline", split.dev) };
    const errored = base.run.trials.filter((t) => t.trace.error);
    const r: Omit<SharpenResult, "message" | "path"> = { id, split, baseline: { dev: rate(base.run, split.dev), trials: base.run.trials.length, errors: errored.length, costUsd: cost(base.run), runId: base.run.runId }, diagnosis: [], candidates: [], verdict: "no gain", stopped: "gate" };
    const finish = (verdict: SharpenVerdict): SharpenResult => {
      r.verdict = verdict;
      const dir = path.join(root, "sharpen");
      fs.mkdirSync(dir, { recursive: true });
      const winner = r.best && r.candidates.find((c) => c.id === r.best!.id);
      const textFile = winner?.text !== undefined && (verdict === "proven" || verdict === "promising") ? path.join(dir, `${id}-best.txt`) : undefined;
      if (textFile) fs.writeFileSync(textFile, winner!.text!);
      const out: SharpenResult = { ...r, message: describe(r, { cwd: opts.cwd, alpha, error: errored[0]?.trace.error, textFile, noKey: Boolean(textHook) && !opts.chat }), path: path.join(dir, `${id}.json`) };
      fs.writeFileSync(out.path, `${JSON.stringify(out, null, 2)}\n`);
      return out;
    };

    // gates: do not spend on proposals when the instrument cannot support them
    if (errored.length > 0.2 * base.run.trials.length) return finish("cannot measure");
    if (failing(base.run, split.dev).length === 0) return finish("nothing to sharpen");
    opts.log?.(`finding why ${base.run.trials.filter((t) => t.pass === false).length} trials fail\n`);
    r.diagnosis = await diagnose(base.run.trials, opts.chat, seed);
    if (!canRewrite && Object.keys(variants).length === 0) return finish("nothing to change");

    const members: Member[] = [base];
    const dev = (m: Member): number => rate(m.run, split.dev);
    const best = (): Member => members.reduce((a, b) => (dev(b) > dev(a) || (dev(b) === dev(a) && cost(b.run) < cost(a.run)) ? b : a));
    let spent = cost(base.run);
    let tried = 0;
    const over = (): SharpenResult["stopped"] | undefined => (opts.maxCost !== undefined && spent >= opts.maxCost ? "maxCost" : opts.until !== undefined && dev(best()) >= opts.until ? "until" : tried >= budget ? "budget" : undefined);
    let stopped: SharpenResult["stopped"] | undefined;

    for (const name of Object.keys(variants)) {
      if ((stopped = over())) break;
      tried++;
      const cid = `variant ${name}`;
      const full = await run({ variant: name }, cid, split.dev);
      spent += cost(full);
      members.push({ id: cid, variant: name, run: full });
      r.candidates.push({ id: cid, kind: "variant", parent: "baseline", variant: name, dev: rate(full, split.dev), costUsd: cost(full), runId: full.runId });
    }

    // rewrites start from the best member so far, so a rewrite lands on top of a variant that helped without anyone combining them;
    // the other way round, a variant is tried again on top of a rewrite that became the best
    const onTop = new Set<string>();
    for (let n = 1; !stopped && canRewrite && !(stopped = over()); ) {
      const parent = best();
      const failed = failing(parent.run, split.dev);
      if (failed.length === 0) break;
      tried++;
      // a variant that did nothing alone may help once the text is right: try each one on a rewrite that became the best
      const again = parent.text !== undefined && !parent.variant ? Object.keys(variants).find((v) => !onTop.has(`${parent.id}|${v}`)) : undefined;
      if (again) {
        onTop.add(`${parent.id}|${again}`);
        const vid = `variant ${again} on ${parent.id}`;
        const full = await run({ variant: again, text: parent.text }, vid, split.dev);
        spent += cost(full);
        members.push({ id: vid, variant: again, text: parent.text, run: full });
        r.candidates.push({ id: vid, kind: "variant", parent: parent.id, variant: again, text: parent.text, dev: rate(full, split.dev), costUsd: cost(full), runId: full.runId });
        continue;
      }
      const cid = `rewrite ${n++}`;
      const text = parent.text ?? textHook!.seed;
      const samples = await spread(parent.run.trials, 6, seed);
      const modes = r.diagnosis.length ? `Failure modes seen:\n${r.diagnosis.map((d) => `- ${d.code}: ${d.definition} (${d.size} trials)`).join("\n")}\n\n` : "";
      const user = `Current text:\n"""\n${text}\n"""\n\nScorers: ${config.scorers.map((s) => String(s.id ?? s.name)).join(", ")}\n\n${modes}${samples.map((t, k) => `--- failure ${k + 1} (case ${t.trace.caseId}) ---\n${summarise(t)}`).join("\n\n")}`;
      opts.log?.(`asking for ${cid} from ${parent.id}\n`);
      // a rewritten prompt can be long; never let the default max_tokens truncate the JSON
      const proposal = parseProposal((await opts.chat!({ system: REFLECT_SYSTEM, json: true, temperature: 0.7, maxTokens: Math.max(4096, text.length * 2), messages: [{ role: "user", content: user }] })).text);
      const common = { id: cid, kind: "text" as const, parent: parent.id, ...(parent.variant ? { variant: parent.variant } : {}) };
      if (!proposal) {
        r.candidates.push({ ...common, costUsd: 0, dropped: "unparseable" });
        continue;
      }
      const child = { variant: parent.variant, text: proposal.text };
      const sampleCases = [...failed, ...split.dev.filter((c) => !failed.includes(c)).slice(0, 8)];
      const quick = await run(child, `${cid} sample`, sampleCases);
      spent += cost(quick);
      const sample = { cases: sampleCases.length, candidate: rate(quick, sampleCases), parent: rate(parent.run, sampleCases) };
      const entry = { ...common, text: proposal.text, rationale: proposal.rationale, sample };
      if (sample.candidate < sample.parent) {
        r.candidates.push({ ...entry, costUsd: cost(quick), dropped: "sample" });
        continue;
      }
      const whole = sampleCases.length === split.dev.length; // the sample already was every dev case
      const full = whole ? quick : await run(child, cid, split.dev);
      if (!whole) spent += cost(full);
      members.push({ id: cid, ...child, run: full });
      r.candidates.push({ ...entry, dev: rate(full, split.dev), costUsd: cost(quick) + (whole ? 0 : cost(full)), runId: full.runId });
    }
    r.stopped = stopped ?? "exhausted";

    const winner = best();
    if (winner === base) return finish("no gain");
    // confirm on cases no proposal has seen; without a held-out set the same comparison is in-sample and can only be promising
    const cases = split.inSample ? split.dev : split.holdout;
    const [b, w] = split.inSample ? [base.run, winner.run] : [await run({}, "baseline, held-out cases", cases), await run(winner, `${winner.id}, held-out cases`, cases)];
    // the unit of the test is the cluster when cases declare one: two phrasings of one question are one piece of evidence
    const units = [...new Set(cases.map((c) => groupOf.get(c)!))].map((group) => {
      const members = cases.filter((c) => groupOf.get(c) === group);
      return { caseId: group, a: rate(w, members), b: rate(b, members) };
    });
    const cmp = units.length >= 2 ? compareTargets(units, 1 - alpha).paired : undefined;
    // an exact sign test as a floor: with identical differences the t test has no variance and reports p = 0 for any n
    const sign = mcnemarExact(units.filter((u) => u.a > u.b).length, units.filter((u) => u.a < u.b).length).p;
    const diff = rate(w, cases) - rate(b, cases);
    const perTrial = (x: RunOutcome): number => cost(x) / Math.max(1, x.trials.length);
    r.best = { id: winner.id, label: winner.id.startsWith("rewrite") && winner.variant ? `${winner.id} (on variant ${winner.variant})` : winner.id, cases: cases.length, baseline: rate(b, cases), candidate: rate(w, cases), diff, lo: cmp?.lo ?? diff, hi: cmp?.hi ?? diff, p: Math.max(cmp?.p ?? 1, sign), ...(perTrial(b) > 0 ? { costRatio: perTrial(w) / perTrial(b) } : {}) };
    if (diff <= 0) return finish("no gain");
    if (r.best.p < alpha && !split.inSample) return finish("proven");
    // six units that all improve are the fewest an exact test can call at 0.05
    r.best.needed = Math.max(6, cmp && cmp.se > 0 ? Math.ceil(pairedPowerN({ effect: diff / (cmp.se * Math.sqrt(cmp.n)), alpha })) : 0);
    return finish("promising");
  } finally {
    store.close();
  }
}
