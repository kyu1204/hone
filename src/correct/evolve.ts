// GEPA-lite: reflect on failures, propose a text change, verify on a minibatch then the full set, keep a Pareto front.
import * as fs from "node:fs";
import * as path from "node:path";
import { summarise } from "../analysis/cluster";
import { Cache } from "../core/cache";
import type { HoneConfig } from "../core/config";
import { Store } from "../core/store";
import type { ChatRequest } from "../providers/llm";
import { wilsonCi } from "../stats/interval";
import { compareTargets } from "../stats/paired";
import type { Candidate, CandidatesFile } from "../tui/screens/candidates";
import { runConfig, type RunOutcome } from "./ablation";

export type ChatFn = (req: ChatRequest) => Promise<{ text: string }>;

export interface EvolveCandidate extends Candidate {
  rationale?: string;
  rejected?: "minibatch" | "unparseable";
  minibatch?: { cases: number; candidate: number; parent: number };
  runId?: string;
}

export interface EvolveFile extends Omit<CandidatesFile, "candidates"> {
  kind: "evolve";
  candidates: EvolveCandidate[];
}

export interface EvolveOptions {
  config: HoneConfig;
  hash: string;
  cwd: string;
  chat: ChatFn;
  budget?: number;
  minibatch?: number;
  trials?: number;
  maxCost?: number;
  alpha?: number;
  useCache?: boolean;
  log?: (s: string) => void;
}

export interface EvolveResult {
  id: string;
  file: EvolveFile;
  verdict: string;
  stopped: "budget" | "maxCost";
  path: string;
}

export function parseProposal(text: string): { text: string; rationale: string } | undefined {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  try {
    const o = JSON.parse(m[0]) as { text?: unknown; rationale?: unknown };
    if (typeof o.text !== "string" || o.text.trim() === "") return undefined;
    return { text: o.text, rationale: typeof o.rationale === "string" ? o.rationale : "" };
  } catch {
    return undefined;
  }
}

export function isDominated(x: { passAt1: number; costUsd: number }, others: { passAt1: number; costUsd: number }[]): boolean {
  return others.some((o) => o !== x && o.passAt1 >= x.passAt1 && o.costUsd <= x.costUsd && (o.passAt1 > x.passAt1 || o.costUsd < x.costUsd));
}

const REFLECT_SYSTEM = `You improve the text that steers an AI system (a prompt, a rule file, a rubric). You see the current text and samples of failed runs. Propose one revised text that addresses the failures without breaking what works. Reply with one JSON object only: {"text": "<the full revised text>", "rationale": "<one sentence>"}.`;

interface Member {
  id: string;
  text: string;
  run: RunOutcome;
  parent?: string;
}

const stats = (run: RunOutcome): { passAt1: number; lo: number; hi: number; costUsd: number } => {
  const n = run.trials.length;
  const k = run.trials.filter((t) => t.pass === true).length;
  const ci = n ? wilsonCi(k, n) : { lo: 0, hi: 1 };
  return { passAt1: run.summary.totals.passAt1, lo: ci.lo, hi: ci.hi, costUsd: run.summary.totals.costUsd };
};

export async function evolve(opts: EvolveOptions): Promise<EvolveResult> {
  const hook = opts.config.evolve;
  if (!hook) throw new Error("config has no evolve hook; add `evolve: { seed, apply }` to hone.config.ts");
  const budget = opts.budget ?? 6;
  const minibatchN = opts.minibatch ?? 8;
  const alpha = opts.alpha ?? 0.05;
  const root = path.resolve(opts.cwd, opts.config.cacheDir ?? ".hone");
  const store = new Store(root);
  const cache = new Cache(path.join(root, "cache"));
  const deps = { cwd: opts.cwd, store, cache, hash: opts.hash, trials: opts.trials, useCache: opts.useCache ?? true, log: opts.log };
  const id = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  try {
    const baseline: Member = { id: "baseline", text: hook.seed, run: await runConfig(hook.apply(opts.config, hook.seed), "baseline", deps) };
    const front: Member[] = [baseline];
    const candidates: EvolveCandidate[] = [];
    let spent = baseline.run.summary.totals.costUsd;
    let stopped: EvolveResult["stopped"] = "budget";
    for (let i = 0; i < budget; i++) {
      if (opts.maxCost !== undefined && spent >= opts.maxCost) {
        stopped = "maxCost";
        break;
      }
      const pareto = front.filter((m) => !isDominated(stats(m.run), front.map((f) => stats(f.run))));
      const parent = pareto[i % pareto.length]!;
      const failures = parent.run.trials.filter((t) => t.pass === false).slice(0, 6).map((t, k) => `--- failure ${k + 1} (case ${t.trace.caseId}) ---\n${summarise(t)}`);
      const user = `Current text:\n"""\n${parent.text}\n"""\n\nScorers: ${opts.config.scorers.map((s) => String(s.id ?? s.name)).join(", ")}\n\n${failures.length ? failures.join("\n\n") : "No failing cases. Propose a shorter text that keeps the behaviour."}`;
      const reply = await opts.chat({ system: REFLECT_SYSTEM, json: true, temperature: 0.7, messages: [{ role: "user", content: user }] });
      const cid = `cand-${candidates.length + 1}`;
      const proposal = parseProposal(reply.text);
      if (!proposal) {
        candidates.push({ id: cid, text: "", passAt1: 0, lo: 0, hi: 0, costUsd: 0, pareto: false, parent: parent.id, rejected: "unparseable" });
        continue;
      }
      const failedCases = [...parent.run.perCase].filter(([, rate]) => rate < 1).map(([c]) => c);
      const passingCases = [...parent.run.perCase].filter(([, rate]) => rate >= 1).map(([c]) => c);
      const mini = [...failedCases, ...passingCases.slice(0, minibatchN)];
      const miniRun = await runConfig(hook.apply(opts.config, proposal.text), `${cid} minibatch`, { ...deps, caseIds: mini });
      spent += miniRun.summary.totals.costUsd;
      const rate = (run: RunOutcome, cases: string[]): number => cases.reduce((s, c) => s + (run.perCase.get(c) ?? 0), 0) / Math.max(1, cases.length);
      const candRate = rate(miniRun, mini);
      const parentRate = rate(parent.run, mini);
      const minibatch = { cases: mini.length, candidate: candRate, parent: parentRate };
      if (candRate < parentRate) {
        candidates.push({ id: cid, text: proposal.text, passAt1: candRate, lo: 0, hi: 1, costUsd: miniRun.summary.totals.costUsd, pareto: false, parent: parent.id, rationale: proposal.rationale, rejected: "minibatch", minibatch, runId: miniRun.runId });
        continue;
      }
      const full = await runConfig(hook.apply(opts.config, proposal.text), cid, deps);
      spent += full.summary.totals.costUsd;
      const member: Member = { id: cid, text: proposal.text, run: full, parent: parent.id };
      front.push(member);
      candidates.push({ id: cid, text: proposal.text, ...stats(full), pareto: false, parent: parent.id, rationale: proposal.rationale, minibatch, runId: full.runId });
    }
    const all = front.map((m) => stats(m.run));
    for (const c of candidates) {
      const m = front.find((f) => f.id === c.id);
      if (m) c.pareto = !isDominated(stats(m.run), all);
    }
    const base: Candidate & { runId: string } = { id: "baseline", text: baseline.text, ...stats(baseline.run), pareto: !isDominated(stats(baseline.run), all), runId: baseline.run.runId };
    const best = front.slice(1).sort((a, b) => stats(b.run).passAt1 - stats(a.run).passAt1 || stats(a.run).costUsd - stats(b.run).costUsd)[0];
    let verdict = "no measurable effect";
    if (best) {
      const shared = [...baseline.run.perCase.keys()].filter((c) => best.run.perCase.has(c)).sort();
      const compare = compareTargets(shared.map((caseId) => ({ caseId, a: best.run.perCase.get(caseId)!, b: baseline.run.perCase.get(caseId)! })), 1 - alpha);
      if (compare.paired.p < alpha && compare.paired.meanDiff > 0) verdict = `${best.id} beats baseline (+${(compare.paired.meanDiff * 100).toFixed(0)} pts, p=${compare.paired.p.toExponential(1)})`;
    }
    const file: EvolveFile = { schemaVersion: 1, kind: "evolve", baseline: base, candidates };
    const dir = path.join(root, "evolve");
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${id}.json`);
    fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, `${id}-baseline.txt`), baseline.text);
    for (const c of candidates) if (c.text) fs.writeFileSync(path.join(dir, `${id}-${c.id}.txt`), c.text);
    return { id, file, verdict, stopped, path: out };
  } finally {
    store.close();
  }
}
