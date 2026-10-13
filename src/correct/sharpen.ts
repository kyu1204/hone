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
import type { Change } from "./change";
import { type ChatFn, parseProposal, REFLECT_SYSTEM } from "./evolve";

export type SharpenVerdict = "proven" | "promising" | "no gain" | "nothing to sharpen" | "nothing to change" | "cannot measure";

/** One entry of the ledger: a change that was tried, why, and what came of it. */
export interface SharpenCandidate {
  id: string;
  /** What it adds to its parent: a config change, a text, or both at once. */
  kind: "variant" | "text" | "both";
  /** Who proposed it: a change file, `sharpen.variants` in the config, or the model. */
  source: "file" | "config" | "model";
  parent: string;
  /** The change file it came from. */
  file?: string;
  /** The author's hypothesis, from the change file. */
  why?: string;
  /** The name of the config change it carries (a variant or a change with `config`), and the file when it came from one. */
  variant?: string;
  variantFile?: string;
  /** The text it carries, and the file when a person or an agent wrote it; a text without a file came from the model. */
  text?: string;
  textFile?: string;
  /** The id of the candidate that introduced this text (itself, for a rewrite or a text change; the parent's, for a pairing). */
  textFrom?: string;
  /** The model's one-line reason for its rewrite. */
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
  /** The changes declared in files under sharpen/ (`loadChanges`). */
  changes?: Change[];
  /** Names the failure modes and writes rewrites. Without it only the changes from files and the declared variants are tried. */
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

/** A config change that can be put on top of a text: an inline variant or a change file with `config`. */
interface ConfigChange {
  key: string;
  name: string;
  apply: (config: HoneConfig) => HoneConfig;
  file?: string;
  why?: string;
}

interface Member {
  id: string;
  cfg?: ConfigChange;
  text?: string;
  textFile?: string;
  textFrom?: string;
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
function describe(r: Omit<SharpenResult, "message" | "path">, x: { cwd: string; alpha: number; error?: string; textFile?: string; changeFile?: string; noKey: boolean }): string {
  const n = r.split.dev.length;
  if (r.verdict === "cannot measure") return `Cannot measure: the system failed to run in ${r.baseline.errors} of ${r.baseline.trials} trials (first error: ${x.error ?? "unknown"}). Fix that first; an error is not a wrong answer.\n`;
  if (r.verdict === "nothing to sharpen") return `Nothing to sharpen: ${n === 1 ? "the one case passes" : `all ${n} cases pass`}. Add cases that are harder.\n`;
  const lines = [`Now: ${pct(r.baseline.dev)} of ${n} cases pass. ${r.split.inSample ? "Too few cases to hold any out, so the final check uses the cases it learned from." : `${r.split.holdout.length} more cases are held out for the final check.`}`];
  if (r.diagnosis.length) {
    const failed = r.diagnosis.reduce((s, d) => s + d.size, 0);
    lines.push("Why it fails:", ...r.diagnosis.map((d, i) => `  ${i + 1}. ${d.code} (${d.size} of ${failed} failed trials, e.g. ${d.example}): ${clip(d.definition, 110)}`));
  }
  if (r.verdict === "nothing to change") {
    lines.push(
      "Nothing to change: there is no change to try. Write one, for example sharpen/first.ts:",
      '  import { change } from "hone-eval";',
      '  change("what it does", { why: "which failure it fixes", text: "the new text" });',
      "A `text` needs `sharpen: { text: { seed, apply } }` in hone.config.ts, which says where a text goes; a `config` function needs nothing.",
      x.noKey ? "sharpen.text is declared, but there is no LLM key for the model to write rewrites with (ANTHROPIC_API_KEY or OPENAI_API_KEY)." : "With `sharpen.text` declared and an LLM key set, a model writes rewrites too.",
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push(`Tried ${plural(r.candidates.length, "change")}:`);
  const width = Math.max(0, ...r.candidates.map((c) => c.id.length)) + 2;
  for (const c of r.candidates) {
    const note = c.parent === "baseline" || c.source === "model" ? (c.why ?? c.rationale) : undefined; // a pairing reuses a change already listed with its reason
    const what = c.dropped === "unparseable" ? "dropped: the model's reply was not usable" : c.dropped === "sample" ? `dropped early: ${pct(c.sample!.candidate)} against ${pct(c.sample!.parent)} on a sample` : `${pct(r.baseline.dev)} -> ${pct(c.dev ?? 0)}${note ? `   ${clip(note, 90)}` : ""}`;
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
    // what to adopt, and where it is
    const w = r.candidates.find((c) => c.id === b.id);
    if (w?.text !== undefined) lines.push(w.textFile ? `The text comes from ${w.textFile}.` : `The new text is in ${path.relative(x.cwd, x.textFile ?? "")} (as a change file: ${path.relative(x.cwd, x.changeFile ?? "")})`);
    if (w?.variant) lines.push(w.variantFile ? `It uses the change "${w.variant}" from ${w.variantFile}.` : `It uses the variant "${w.variant}" from sharpen.variants.`);
  }
  if (x.noKey && !r.candidates.some((c) => c.textFile)) lines.push("No LLM key (ANTHROPIC_API_KEY or OPENAI_API_KEY): rewrites of sharpen.text were not tried and the failure groups are unnamed.");
  return `${lines.join("\n")}\n`;
}

/** A model's winning rewrite in the form a person writes: a change file that can be moved into sharpen/. */
function asChangeFile(winner: SharpenCandidate, origin: SharpenCandidate, verdict: SharpenVerdict): string {
  const together = winner.variant ? `// It was confirmed together with ${winner.variantFile ? `the change "${winner.variant}" (${winner.variantFile})` : `the variant "${winner.variant}" (sharpen.variants)`}.\n` : "";
  return `// Proposed by the model as ${origin.id}; the held-out check said: ${verdict}. Move this file into sharpen/ to keep it as a candidate.\n${together}import { change } from "hone-eval";\n\nchange(${JSON.stringify(origin.id)}, {\n  why: ${JSON.stringify(origin.rationale || "rewritten by the model from the failure modes")},\n  text: ${JSON.stringify(winner.text)},\n});\n`;
}

export async function sharpen(opts: SharpenOptions): Promise<SharpenResult> {
  const { config } = opts;
  const budget = opts.budget ?? 6;
  const alpha = opts.alpha ?? 0.05;
  const seed = opts.seed ?? 1;
  const textHook = config.sharpen?.text;
  const changes = opts.changes ?? [];
  for (const c of changes) if (c.text !== undefined && !textHook) throw new Error(`${c.file ?? "a change"}: change "${c.name}" sets a text, but hone.config.ts declares no \`sharpen: { text: { seed, apply } }\` to put it into`);
  // config changes that can be put on top of a text: the ones from files first, then the inline variants
  const fromFiles: ConfigChange[] = changes.filter((c) => c.config && c.text === undefined).map((c) => ({ key: c.name, name: c.name, apply: c.config!, file: c.file, why: c.why }));
  const inline: ConfigChange[] = Object.entries(config.sharpen?.variants ?? {}).map(([name, apply]) => ({ key: `variant ${name}`, name, apply }));
  const fileTexts = changes.filter((c) => c.text !== undefined && !c.config);
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
    const build = (m: { cfg?: ConfigChange; text?: string }): HoneConfig => {
      const c = m.cfg ? m.cfg.apply(config) : config;
      return textHook && m.text !== undefined ? textHook.apply(c, m.text) : c;
    };
    const run = (m: { cfg?: ConfigChange; text?: string }, label: string, caseIds: string[]): Promise<RunOutcome> => runConfig(build(m), label, { ...deps, caseIds });
    const cost = (r: RunOutcome): number => r.summary.totals.costUsd;

    const base: Member = { id: "baseline", run: await run({}, "baseline", split.dev) };
    const errored = base.run.trials.filter((t) => t.trace.error);
    const r: Omit<SharpenResult, "message" | "path"> = { id, split, baseline: { dev: rate(base.run, split.dev), trials: base.run.trials.length, errors: errored.length, costUsd: cost(base.run), runId: base.run.runId }, diagnosis: [], candidates: [], verdict: "no gain", stopped: "gate" };
    const finish = (verdict: SharpenVerdict): SharpenResult => {
      r.verdict = verdict;
      const dir = path.join(root, "sharpen");
      fs.mkdirSync(dir, { recursive: true });
      // a text the model wrote is saved, as plain text and as a change file; a text from a file already is one
      const winner = r.best && r.candidates.find((c) => c.id === r.best!.id);
      const save = winner?.text !== undefined && !winner.textFile && (verdict === "proven" || verdict === "promising");
      const textFile = save ? path.join(dir, `${id}-best.txt`) : undefined;
      const changeFile = save ? path.join(dir, `${id}-best.ts`) : undefined;
      if (textFile && changeFile) {
        fs.writeFileSync(textFile, winner!.text!);
        fs.writeFileSync(changeFile, asChangeFile(winner!, r.candidates.find((c) => c.id === winner!.textFrom) ?? winner!, verdict));
      }
      const out: SharpenResult = { ...r, message: describe(r, { cwd: opts.cwd, alpha, error: errored[0]?.trace.error, textFile, changeFile, noKey: Boolean(textHook) && !opts.chat }), path: path.join(dir, `${id}.json`) };
      fs.writeFileSync(out.path, `${JSON.stringify(out, null, 2)}\n`);
      return out;
    };

    // gates: do not spend on proposals when the instrument cannot support them
    if (errored.length > 0.2 * base.run.trials.length) return finish("cannot measure");
    if (failing(base.run, split.dev).length === 0) return finish("nothing to sharpen");
    opts.log?.(`finding why ${base.run.trials.filter((t) => t.pass === false).length} trials fail\n`);
    r.diagnosis = await diagnose(base.run.trials, opts.chat, seed);
    if (!canRewrite && changes.length === 0 && inline.length === 0) return finish("nothing to change");

    const members: Member[] = [base];
    const dev = (m: Member): number => rate(m.run, split.dev);
    const best = (): Member => members.reduce((a, b) => (dev(b) > dev(a) || (dev(b) === dev(a) && cost(b.run) < cost(a.run)) ? b : a));
    let spent = cost(base.run);
    let tried = 0;
    const over = (): SharpenResult["stopped"] | undefined => (opts.maxCost !== undefined && spent >= opts.maxCost ? "maxCost" : opts.until !== undefined && dev(best()) >= opts.until ? "until" : tried >= budget ? "budget" : undefined);
    let stopped: SharpenResult["stopped"] | undefined;
    const carried = (m: { cfg?: ConfigChange; text?: string; textFile?: string; textFrom?: string }): Partial<SharpenCandidate> => ({
      ...(m.cfg ? { variant: m.cfg.name, ...(m.cfg.file ? { variantFile: m.cfg.file } : {}) } : {}),
      ...(m.text !== undefined ? { text: m.text, ...(m.textFile ? { textFile: m.textFile } : {}), ...(m.textFrom ? { textFrom: m.textFrom } : {}) } : {}),
    });

    /** A config change on top of `parent`: described in a line, so it gets its full run at once. */
    const tryConfig = async (parent: Member, cfg: ConfigChange, cid: string): Promise<void> => {
      tried++;
      const child = { cfg, text: parent.text, textFile: parent.textFile, textFrom: parent.textFrom };
      const full = await run(child, cid, split.dev);
      spent += cost(full);
      members.push({ id: cid, ...child, run: full });
      r.candidates.push({ id: cid, kind: "variant", source: cfg.file ? "file" : "config", parent: parent.id, ...(cfg.file ? { file: cfg.file } : {}), ...(cfg.why ? { why: cfg.why } : {}), ...carried(child), dev: rate(full, split.dev), costUsd: cost(full), runId: full.runId });
    };
    /** A text on top of `parent`: first on the parent's failing cases plus eight passing ones, and only then in full. */
    const tryText = async (parent: Member, cid: string, text: { cfg?: ConfigChange; text: string; textFile?: string }, meta: Pick<SharpenCandidate, "kind" | "source" | "file" | "why" | "rationale">): Promise<void> => {
      tried++;
      const child = { ...text, textFrom: cid };
      const failed = failing(parent.run, split.dev);
      const sampleCases = [...failed, ...split.dev.filter((c) => !failed.includes(c)).slice(0, 8)];
      const quick = await run(child, `${cid} sample`, sampleCases);
      spent += cost(quick);
      const sample = { cases: sampleCases.length, candidate: rate(quick, sampleCases), parent: rate(parent.run, sampleCases) };
      const entry = { id: cid, ...meta, parent: parent.id, ...carried(child), sample };
      if (sample.candidate < sample.parent) {
        r.candidates.push({ ...entry, costUsd: cost(quick), dropped: "sample" });
        return;
      }
      const whole = sampleCases.length === split.dev.length; // the sample already was every dev case
      const full = whole ? quick : await run(child, cid, split.dev);
      if (!whole) spent += cost(full);
      members.push({ id: cid, ...child, run: full });
      r.candidates.push({ ...entry, dev: rate(full, split.dev), costUsd: cost(quick) + (whole ? 0 : cost(full)), runId: full.runId });
    };

    // 1. every change from a file on its own, then every inline variant on its own
    for (const c of changes) {
      if ((stopped = over())) break;
      const meta = { source: "file" as const, ...(c.file ? { file: c.file } : {}), why: c.why };
      if (c.text === undefined) await tryConfig(base, fromFiles.find((f) => f.key === c.name)!, c.name);
      else await tryText(base, c.name, { ...(c.config ? { cfg: { key: c.name, name: c.name, apply: c.config, file: c.file, why: c.why } } : {}), text: c.text, textFile: c.file }, { kind: c.config ? "both" : "text", ...meta });
    }
    for (const v of inline) {
      if (stopped || (stopped = over())) break;
      await tryConfig(base, v, v.key);
    }

    // 2. from the best member so far: the primitive of the kind it lacks (a config change on a text, a text from a file on
    //    a config change), so changes that only help together are found without anyone combining them; then a rewrite
    const paired = new Set<string>();
    for (let n = 1; !stopped && !(stopped = over()); ) {
      const parent = best();
      if (failing(parent.run, split.dev).length === 0) break;
      const fresh = (key: string): boolean => !paired.has(`${parent.id}|${key}`) && paired.add(`${parent.id}|${key}`).size > 0;
      const cfg = parent.text !== undefined && !parent.cfg ? [...fromFiles, ...inline].find((c) => fresh(c.key)) : undefined;
      if (cfg) {
        await tryConfig(parent, cfg, `${cfg.key} on ${parent.id}`);
        continue;
      }
      const text = parent.cfg && parent.text === undefined ? fileTexts.find((t) => fresh(t.name)) : undefined;
      if (text) {
        await tryText(parent, `${text.name} on ${parent.id}`, { cfg: parent.cfg, text: text.text!, textFile: text.file }, { kind: "text", source: "file", ...(text.file ? { file: text.file } : {}), why: text.why });
        continue;
      }
      if (!canRewrite) break;
      const cid = `rewrite ${n++}`;
      const current = parent.text ?? textHook!.seed;
      const samples = await spread(parent.run.trials, 6, seed);
      const modes = r.diagnosis.length ? `Failure modes seen:\n${r.diagnosis.map((d) => `- ${d.code}: ${d.definition} (${d.size} trials)`).join("\n")}\n\n` : "";
      const user = `Current text:\n"""\n${current}\n"""\n\nScorers: ${config.scorers.map((s) => String(s.id ?? s.name)).join(", ")}\n\n${modes}${samples.map((t, k) => `--- failure ${k + 1} (case ${t.trace.caseId}) ---\n${summarise(t)}`).join("\n\n")}`;
      opts.log?.(`asking for ${cid} from ${parent.id}\n`);
      // a rewritten prompt can be long; never let the default max_tokens truncate the JSON
      const proposal = parseProposal((await opts.chat!({ system: REFLECT_SYSTEM, json: true, temperature: 0.7, maxTokens: Math.max(4096, current.length * 2), messages: [{ role: "user", content: user }] })).text);
      if (!proposal) {
        tried++;
        r.candidates.push({ id: cid, kind: "text", source: "model", parent: parent.id, ...carried({ cfg: parent.cfg }), costUsd: 0, dropped: "unparseable" });
        continue;
      }
      await tryText(parent, cid, { cfg: parent.cfg, text: proposal.text }, { kind: "text", source: "model", rationale: proposal.rationale });
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
    r.best = { id: winner.id, label: winner.id.startsWith("rewrite") && winner.cfg ? `${winner.id} (on ${winner.cfg.key})` : winner.id, cases: cases.length, baseline: rate(b, cases), candidate: rate(w, cases), diff, lo: cmp?.lo ?? diff, hi: cmp?.hi ?? diff, p: Math.max(cmp?.p ?? 1, sign), ...(perTrial(b) > 0 ? { costRatio: perTrial(w) / perTrial(b) } : {}) };
    if (diff <= 0) return finish("no gain");
    if (r.best.p < alpha && !split.inSample) return finish("proven");
    // six units that all improve are the fewest an exact test can call at 0.05
    r.best.needed = Math.max(6, cmp && cmp.se > 0 ? Math.ceil(pairedPowerN({ effect: diff / (cmp.se * Math.sqrt(cmp.n)), alpha })) : 0);
    return finish("promising");
  } finally {
    store.close();
  }
}
