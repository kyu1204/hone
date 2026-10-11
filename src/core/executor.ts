import { cachedScorer } from "../scorers/cached";
import { runScorer, type ScoreContext, type Scorer } from "../scorers/scorer";
import { type RunContext, type Target, type TargetOutput, toTrace } from "../targets/target";
import { type Cache, cacheKey } from "./cache";
import type { GateSpec, ScorerSpec } from "./config";
import type { HoneEvents } from "./events";
import type { PlanCell } from "./plan";
import { Store } from "./store";
import type { Case, Score, Trace, Trial, TrialFlag } from "./types";

export interface ExecutorDeps {
  targets: Record<string, Target>;
  scorers: Scorer[];
  /** Specs aligned with `scorers`, used for cache keys. Defaults to `{ name }`. */
  scorerSpecs?: ScorerSpec[];
  cases: Case[];
  cache: Cache;
  store: Store;
  events: HoneEvents;
  gates?: GateSpec;
  runId: string;
  useCache?: boolean;
  signal?: AbortSignal;
}

interface CachedRun {
  output: TargetOutput;
  startedAt: string;
  endedAt: string;
}

export type Execute = (cell: PlanCell, trial: number) => Promise<Trial>;

export function createExecutor(deps: ExecutorDeps): Execute {
  const useCache = deps.useCache ?? true;
  const caseById = new Map(deps.cases.map((c) => [c.id, c]));
  const versions = new Map<string, Promise<string>>();
  const version = (id: string, t: Target): Promise<string> => {
    let v = versions.get(id);
    if (!v) {
      v = t.version();
      versions.set(id, v);
    }
    return v;
  };
  const scorers = deps.scorers.map((s, i) => (useCache ? cachedScorer(s, deps.cache, deps.scorerSpecs?.[i] ?? { name: s.name }) : s));
  const hackMode = deps.gates?.rewardHack ?? "fail";

  const runTarget = async (target: Target, targetId: string, input: unknown, ctx: RunContext): Promise<CachedRun & { cached: boolean }> => {
    const key = cacheKey({ input, targetVersion: await version(targetId, target), targetId });
    if (useCache) {
      const hit = deps.cache.get<CachedRun>(key);
      if (hit) return { ...hit, cached: true };
    }
    const startedAt = new Date();
    let output: TargetOutput;
    try {
      output = await target.run(input, ctx);
    } catch (e) {
      output = { output: null, error: e instanceof Error ? e.message : String(e) };
    }
    const entry: CachedRun = { output, startedAt: startedAt.toISOString(), endedAt: new Date().toISOString() };
    if (useCache && !output.error) deps.cache.set(key, entry);
    return { ...entry, cached: false };
  };

  return async (cell, trial) => {
    const c = caseById.get(cell.caseId);
    if (!c) throw new Error(`case "${cell.caseId}" not found`);
    const target = deps.targets[cell.targetId];
    if (!target) throw new Error(`target "${cell.targetId}" not found`);
    const ctx: RunContext = { runId: deps.runId, caseId: c.id, trial, ...(deps.signal ? { signal: deps.signal } : {}) };

    const run = await runTarget(target, cell.targetId, c.input, ctx);
    let trace: Trace;
    try {
      trace = toTrace(run.output, ctx, cell.targetId, new Date(run.startedAt), new Date(run.endedAt));
    } catch (e) {
      trace = toTrace({ output: null, error: `target returned an invalid trace: ${e instanceof Error ? e.message : String(e)}` }, ctx, cell.targetId, new Date(run.startedAt), new Date(run.endedAt));
    }

    const sctx: ScoreContext = {
      case: c,
      trace,
      trial,
      ...(deps.signal ? { signal: deps.signal } : {}),
      runTarget: async (input) => (await runTarget(target, cell.targetId, input, ctx)).output,
    };
    const scores: Score[] = [];
    for (const scorer of scorers) {
      const score = await runScorer(scorer, sctx);
      scores.push(score);
      deps.events.emit("score:done", { trialId: Store.trialId(deps.runId, c.id, cell.targetId, trial), score });
    }

    const flags: TrialFlag[] = [];
    if (run.cached) flags.push("cached");
    if (trace.error === "timeout") flags.push("timeout");
    const isHack = (s: Score): boolean => s.scorer.startsWith("hack");
    const hacked = scores.some((s) => isHack(s) && s.pass === false);
    if (hacked && hackMode !== "ignore") flags.push("reward-hack");
    const counted = hackMode === "fail" ? scores : scores.filter((s) => !isHack(s));

    let pass: boolean | null;
    if (trace.error !== undefined || counted.some((s) => s.pass === false)) pass = false;
    else if (counted.some((s) => s.pass === true)) pass = true;
    else pass = null;

    const trialRecord: Trial = {
      id: Store.trialId(deps.runId, c.id, cell.targetId, trial),
      runId: deps.runId,
      trace,
      scores,
      flags,
      pass,
      costUsd: trace.usage.costUsd + scores.reduce((a, s) => a + (s.costUsd ?? 0), 0),
    };
    deps.store.saveTrial(trialRecord);
    return trialRecord;
  };
}
