// Run the baseline config and each named ablation over the same cases, then compare paired.
import * as path from "node:path";
import { Cache } from "../core/cache";
import { type HoneConfig, loadCases } from "../core/config";
import { HoneEvents } from "../core/events";
import { createExecutor } from "../core/executor";
import { buildPlan } from "../core/plan";
import { type RunSummary, runPlan } from "../core/scheduler";
import { Store } from "../core/store";
import type { Trial } from "../core/types";
import { createScorers } from "../scorers/index";
import { createTargets } from "../targets/index";
import { type CompareResult, compareTargets } from "../stats/paired";

export interface AblationReport {
  name: string;
  runId: string;
  passAt1: number;
  costUsd: number;
  delta: number;
  costDelta: number;
  p: number;
  lo: number;
  hi: number;
  verdict: "component helps" | "component hurts" | "no measurable effect";
  compare: CompareResult;
}

export interface AblationResult {
  baseline: { runId: string; passAt1: number; costUsd: number };
  ablations: AblationReport[];
}

export interface RunOutcome {
  runId: string;
  summary: RunSummary;
  /** Pass rate per case over its trials. */
  perCase: Map<string, number>;
  trials: Trial[];
}

/** Run one config (optionally only `caseIds`) into a fresh run; shared by ablate, evolve and optimize. */
export async function runConfig(config: HoneConfig, label: string, deps: { cwd: string; store: Store; cache: Cache; hash: string; trials?: number; useCache: boolean; caseIds?: string[]; log?: (s: string) => void }): Promise<RunOutcome> {
  const all = await loadCases(config.cases, deps.cwd);
  const cases = deps.caseIds ? all.filter((c) => deps.caseIds!.includes(c.id)) : all;
  const targets = createTargets(config.targets);
  const scorers = createScorers(config.scorers);
  const effective = deps.trials !== undefined ? { ...config, trials: deps.trials } : config;
  const plan = buildPlan({ config: effective, cases, targets: Object.keys(targets) });
  const events = new HoneEvents();
  const trials: Trial[] = [];
  events.on("trial:done", ({ trial }) => trials.push(trial));
  const run = deps.store.createRun({ configHash: deps.hash, targets: Object.keys(targets), caseIds: cases.map((c) => c.id) });
  const execute = createExecutor({ targets, scorers, scorerSpecs: config.scorers, cases, cache: deps.cache, store: deps.store, events, gates: config.gates, runId: run.id, useCache: deps.useCache });
  deps.log?.(`running ${label} (${plan.cells.length} cells x ${plan.trials})\n`);
  const summary = await runPlan(plan, { runId: run.id, execute, events });
  deps.store.finishRun(run.id, { ...(summary as unknown as Record<string, unknown>), ablation: label });
  for (const t of Object.values(targets)) await t.close?.();
  const perCase = new Map<string, number>();
  const byCase = new Map<string, Trial[]>();
  for (const t of trials) (byCase.get(t.trace.caseId) ?? byCase.set(t.trace.caseId, []).get(t.trace.caseId)!).push(t);
  for (const [id, ts] of byCase) perCase.set(id, ts.filter((t) => t.pass === true).length / ts.length);
  return { runId: run.id, summary, perCase, trials };
}

export async function runAblations(opts: { config: HoneConfig; hash: string; cwd: string; names?: string[]; trials?: number; alpha?: number; useCache?: boolean; log?: (s: string) => void }): Promise<AblationResult> {
  const all = opts.config.ablations ?? {};
  const names = opts.names?.length ? opts.names : Object.keys(all);
  for (const n of names) if (!all[n]) throw new Error(`unknown ablation "${n}"; known: ${Object.keys(all).join(", ") || "(none)"}`);
  if (names.length === 0) throw new Error("config has no ablations; add `ablations: { name: (config) => config }` to hone.config.ts");
  const root = path.resolve(opts.cwd, opts.config.cacheDir ?? ".hone");
  const store = new Store(root);
  const cache = new Cache(path.join(root, "cache"));
  const alpha = opts.alpha ?? 0.05;
  try {
    const deps = { cwd: opts.cwd, store, cache, hash: opts.hash, trials: opts.trials, useCache: opts.useCache ?? true, log: opts.log };
    const base = await runConfig(opts.config, "baseline", deps);
    const ablations: AblationReport[] = [];
    for (const name of names) {
      const transformed = all[name]!(opts.config);
      const out = await runConfig(transformed, name, deps);
      const shared = [...base.perCase.keys()].filter((c) => out.perCase.has(c)).sort();
      const rows = shared.map((caseId) => ({ caseId, a: out.perCase.get(caseId)!, b: base.perCase.get(caseId)! }));
      const compare = compareTargets(rows, 1 - alpha);
      const delta = compare.paired.meanDiff;
      const verdict: AblationReport["verdict"] = compare.paired.p < alpha ? (delta < 0 ? "component helps" : "component hurts") : "no measurable effect";
      ablations.push({ name, runId: out.runId, passAt1: out.summary.totals.passAt1, costUsd: out.summary.totals.costUsd, delta, costDelta: out.summary.totals.costUsd - base.summary.totals.costUsd, p: compare.paired.p, lo: compare.paired.lo, hi: compare.paired.hi, verdict, compare });
    }
    ablations.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return { baseline: { runId: base.runId, passAt1: base.summary.totals.passAt1, costUsd: base.summary.totals.costUsd }, ablations };
  } finally {
    store.close();
  }
}
