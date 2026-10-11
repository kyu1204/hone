import { intervalWidth, shouldStop } from "../stats/sequential";
import { verdictFor } from "../stats/passk";
import type { HoneEvents } from "./events";
import type { Plan, PlanCell } from "./plan";
import type { Trial, Verdict } from "./types";

export interface RunSummary {
  runId: string;
  cells: Verdict[];
  totals: { trials: number; passed: number; passAt1: number; costUsd: number; durationMs: number; cached: number; flagged: Record<string, number> };
  stoppedEarly: number;
  aborted: boolean;
}

export interface SchedulerDeps {
  runId: string;
  execute: (cell: PlanCell, trial: number) => Promise<Trial>;
  events: HoneEvents;
  signal?: AbortSignal;
  retries?: number;
}

const TRANSIENT = /timeout|ECONN|fetch failed|exited/i;

interface CellState extends PlanCell {
  key: string;
  outcomes: boolean[];
  scheduled: number;
  stopped?: "ci-width" | "max-trials";
}

export async function runPlan(plan: Plan, deps: SchedulerDeps): Promise<RunSummary> {
  const retries = deps.retries ?? 1;
  const started = Date.now();
  const cells: CellState[] = plan.cells.map((c) => ({ ...c, key: `${c.caseId}\u0000${c.targetId}`, outcomes: [], scheduled: 0 }));
  const trials: Trial[] = [];
  const adaptive = plan.adaptive;
  const minTrials = adaptive?.minTrials ?? 2;
  let aborted = false;
  let stoppedEarly = 0;

  deps.events.emit("run:start", { runId: deps.runId, total: adaptive ? cells.length * adaptive.maxTrials : cells.length * plan.trials });

  // Fixed mode: trial-major order so early results cover every cell.
  const fixedQueue: { cell: CellState; trial: number }[] = [];
  if (!adaptive) for (let t = 0; t < plan.trials; t++) for (const cell of cells) fixedQueue.push({ cell, trial: t });

  const nextJob = (): { cell: CellState; trial: number } | undefined => {
    if (deps.signal?.aborted) {
      aborted = true;
      return undefined;
    }
    if (!adaptive) {
      const job = fixedQueue.shift();
      if (job) job.cell.scheduled++;
      return job;
    }
    let best: CellState | undefined;
    let bestWidth = -1;
    for (const c of cells) {
      if (c.stopped || c.scheduled >= adaptive.maxTrials) continue;
      const done = c.outcomes.length;
      const width = done < minTrials ? 2 - c.scheduled / minTrials : intervalWidth(c.outcomes.filter(Boolean).length, done);
      if (done >= minTrials && c.scheduled >= done && width <= adaptive.ciWidth) continue;
      if (width > bestWidth) {
        best = c;
        bestWidth = width;
      }
    }
    if (!best) return undefined;
    return { cell: best, trial: best.scheduled++ };
  };

  const record = (cell: CellState, trial: Trial): void => {
    trials.push(trial);
    cell.outcomes.push(trial.pass === true);
    const verdict = verdictFor(cell.caseId, cell.targetId, cell.outcomes);
    deps.events.emit("stat:update", { caseId: cell.caseId, targetId: cell.targetId, verdict });
    if (adaptive && !cell.stopped) {
      const s = shouldStop({ successes: cell.outcomes.filter(Boolean).length, n: cell.outcomes.length, minTrials, maxTrials: adaptive.maxTrials, ciWidth: adaptive.ciWidth });
      if (s.stop && s.reason) {
        cell.stopped = s.reason;
        if (s.reason === "ci-width") stoppedEarly++;
        deps.events.emit("case:stopped", { caseId: cell.caseId, targetId: cell.targetId, reason: s.reason });
      }
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const job = nextJob();
      if (!job) return;
      const { cell, trial: index } = job;
      deps.events.emit("trial:start", { trialId: `${deps.runId}:${cell.caseId}:${cell.targetId}:${index}`, caseId: cell.caseId, targetId: cell.targetId, trial: index });
      let result: Trial | undefined;
      for (let attempt = 1; attempt <= retries + 1; attempt++) {
        result = await deps.execute({ caseId: cell.caseId, targetId: cell.targetId }, index);
        if (attempt > 1) (result.trace.meta ??= {}).attempts = attempt;
        if (!(result.trace.error && TRANSIENT.test(result.trace.error) && attempt <= retries)) break;
      }
      record(cell, result!);
      deps.events.emit("trial:done", { trial: result!, cached: result!.flags.includes("cached") });
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, plan.concurrency) }, worker));
  if (deps.signal?.aborted) aborted = true;

  const flagged: Record<string, number> = {};
  for (const t of trials) for (const f of t.flags) flagged[f] = (flagged[f] ?? 0) + 1;
  const passed = trials.filter((t) => t.pass === true).length;
  const summary: RunSummary = {
    runId: deps.runId,
    cells: cells.map((c) => verdictFor(c.caseId, c.targetId, c.outcomes)),
    totals: {
      trials: trials.length,
      passed,
      passAt1: trials.length ? passed / trials.length : 0,
      costUsd: trials.reduce((a, t) => a + t.costUsd, 0),
      durationMs: Date.now() - started,
      cached: flagged.cached ?? 0,
      flagged,
    },
    stoppedEarly,
    aborted,
  };
  deps.events.emit("run:done", { runId: deps.runId, summary: summary as unknown as Record<string, unknown> });
  return summary;
}
