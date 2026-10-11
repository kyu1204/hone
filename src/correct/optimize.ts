// Spend a trial budget across named candidates with Thompson sampling, then decide with a paired test.
import * as fs from "node:fs";
import * as path from "node:path";
import { Cache } from "../core/cache";
import { type HoneConfig, loadCases } from "../core/config";
import { HoneEvents } from "../core/events";
import { createExecutor, type Execute } from "../core/executor";
import { Store } from "../core/store";
import type { Trial } from "../core/types";
import { createScorers } from "../scorers/index";
import { allocate, BetaBandit } from "../stats/bandit";
import { wilsonCi } from "../stats/interval";
import { compareTargets } from "../stats/paired";
import { createTargets } from "../targets/index";
import type { Target } from "../targets/target";
import type { Candidate, CandidatesFile } from "../tui/screens/candidates";

export interface OptimizeOptions {
  config: HoneConfig;
  hash: string;
  cwd: string;
  budget?: number;
  batch?: number;
  confidence?: number;
  alpha?: number;
  minPerArm?: number;
  seed?: number;
  /** After the bandit stops, give baseline and the best arm one trial on every case they have not seen (default true). */
  verify?: boolean;
  useCache?: boolean;
  log?: (s: string) => void;
}

export interface OptimizeArm {
  id: string;
  runId: string;
  trials: number;
  /** Trials allocated by the bandit (the rest came from verification). */
  banditTrials: number;
  passed: number;
  /** Cases with at least one observation. */
  cases: number;
  passAt1: number;
  lo: number;
  hi: number;
  probBest: number;
  costUsd: number;
}

export interface OptimizeResult {
  id: string;
  file: CandidatesFile;
  arms: OptimizeArm[];
  verdict: string;
  stopped: "budget" | "confidence";
  /** Trials spent by the bandit phase. */
  spent: number;
  /** Extra trials spent covering every case for the paired verdict. */
  verified: number;
  path: string;
}

/** Share of Thompson draws each arm wins. */
export function probBest(bandit: BetaBandit, draws = 2000): Record<string, number> {
  const counts = allocate(bandit, draws);
  return Object.fromEntries(Object.entries(counts).map(([arm, n]) => [arm, n / draws]));
}

interface ArmState {
  id: string;
  runId: string;
  execute: Execute;
  targets: Record<string, Target>;
  cells: { caseId: string; targetId: string }[];
  perCell: Map<string, number>;
  perCase: Map<string, { passed: number; trials: number }>;
  trials: Trial[];
}

export async function optimize(opts: OptimizeOptions): Promise<OptimizeResult> {
  const hook = opts.config.optimize;
  if (!hook || Object.keys(hook).length === 0) throw new Error("config has no optimize candidates; add `optimize: { name: (config) => config }` to hone.config.ts");
  if (hook.baseline) throw new Error('"baseline" is reserved for the unmodified config');
  const budget = opts.budget ?? 60;
  const batch = opts.batch ?? 10;
  const confidence = opts.confidence ?? 0.95;
  const alpha = opts.alpha ?? 0.05;
  const minPerArm = opts.minPerArm ?? 3;
  const root = path.resolve(opts.cwd, opts.config.cacheDir ?? ".hone");
  const store = new Store(root);
  const cache = new Cache(path.join(root, "cache"));
  const id = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const arms: ArmState[] = [];
  try {
    const variants: [string, HoneConfig][] = [["baseline", opts.config], ...Object.entries(hook).map(([name, f]): [string, HoneConfig] => [name, f(opts.config)])];
    for (const [name, cfg] of variants) {
      const cases = await loadCases(cfg.cases, opts.cwd);
      const targets = createTargets(cfg.targets);
      const run = store.createRun({ configHash: opts.hash, targets: Object.keys(targets), caseIds: cases.map((c) => c.id) });
      const events = new HoneEvents();
      const execute = createExecutor({ targets, scorers: createScorers(cfg.scorers), scorerSpecs: cfg.scorers, cases, cache, store, events, gates: cfg.gates, runId: run.id, useCache: opts.useCache ?? true });
      const cells = cases.flatMap((c) => Object.keys(targets).map((t) => ({ caseId: c.id, targetId: t })));
      arms.push({ id: name, runId: run.id, execute, targets, cells, perCell: new Map(), perCase: new Map(), trials: [] });
    }
    const bandit = new BetaBandit(arms.map((a) => a.id), opts.seed ?? 0);
    const byId = new Map(arms.map((a) => [a.id, a]));
    let spent = 0;
    let stopped: OptimizeResult["stopped"] = "budget";
    let probs = probBest(bandit);
    const runOne = async (arm: ArmState, cell: { caseId: string; targetId: string }): Promise<void> => {
      const key = `${cell.caseId}\0${cell.targetId}`;
      const trialIdx = arm.perCell.get(key) ?? 0;
      arm.perCell.set(key, trialIdx + 1);
      const trial = await arm.execute(cell, trialIdx);
      arm.trials.push(trial);
      const pc = arm.perCase.get(cell.caseId) ?? { passed: 0, trials: 0 };
      pc.trials++;
      if (trial.pass === true) pc.passed++;
      arm.perCase.set(cell.caseId, pc);
      bandit.update(arm.id, trial.pass === true);
    };
    while (spent < budget) {
      const counts = allocate(bandit, Math.min(batch, budget - spent));
      opts.log?.(`round: ${Object.entries(counts).filter(([, n]) => n > 0).map(([a, n]) => `${a} x${n}`).join(", ")}\n`);
      for (const [armId, n] of Object.entries(counts)) {
        const arm = byId.get(armId)!;
        for (let k = 0; k < n; k++) {
          // least observed cell first, so every arm eventually covers every case
          const cell = arm.cells.reduce((best, c) => ((arm.perCell.get(`${c.caseId}\0${c.targetId}`) ?? 0) < (arm.perCell.get(`${best.caseId}\0${best.targetId}`) ?? 0) ? c : best), arm.cells[0]!);
          await runOne(arm, cell);
          spent++;
        }
      }
      probs = probBest(bandit);
      const covered = arms.every((a) => a.trials.length >= minPerArm);
      if (covered && Math.max(...Object.values(probs)) >= confidence) {
        stopped = "confidence";
        break;
      }
    }
    const banditTrials = new Map(arms.map((a) => [a.id, a.trials.length]));
    let verified = 0;
    const leader = arms.filter((a) => a.id !== "baseline").sort((x, y) => bandit.posterior(y.id).mean - bandit.posterior(x.id).mean)[0];
    if (opts.verify !== false && leader) {
      for (const arm of [byId.get("baseline")!, leader]) {
        for (const cell of arm.cells) {
          if (arm.perCase.has(cell.caseId)) continue;
          await runOne(arm, cell);
          verified++;
        }
      }
      if (verified) opts.log?.(`verification: ${verified} extra trials so baseline and ${leader.id} cover every case\n`);
      probs = probBest(bandit);
    }
    const report: OptimizeArm[] = arms.map((a) => {
      const passed = a.trials.filter((t) => t.pass === true).length;
      const ci = a.trials.length ? wilsonCi(passed, a.trials.length) : { lo: 0, hi: 1 };
      return { id: a.id, runId: a.runId, trials: a.trials.length, banditTrials: banditTrials.get(a.id) ?? a.trials.length, passed, cases: a.perCase.size, passAt1: bandit.posterior(a.id).mean, lo: ci.lo, hi: ci.hi, probBest: probs[a.id] ?? 0, costUsd: a.trials.reduce((s, t) => s + t.costUsd, 0) };
    });
    for (const a of arms) {
      const r = report.find((x) => x.id === a.id)!;
      store.finishRun(a.runId, { optimize: a.id, totals: { trials: r.trials, passed: r.passed, passAt1: r.trials ? r.passed / r.trials : 0, costUsd: r.costUsd } });
      for (const t of Object.values(a.targets)) await t.close?.();
    }
    const baseline = byId.get("baseline")!;
    const best = report.filter((r) => r.id !== "baseline").sort((x, y) => y.passAt1 - x.passAt1)[0];
    let verdict = "no measurable effect";
    if (best && best.passAt1 > report.find((r) => r.id === "baseline")!.passAt1) {
      const bestArm = byId.get(best.id)!;
      const shared = [...baseline.perCase.keys()].filter((c) => bestArm.perCase.has(c)).sort();
      if (shared.length < 2) verdict = `no measurable effect (only ${shared.length} shared case${shared.length === 1 ? "" : "s"})`;
      else {
        const rate = (a: ArmState, c: string): number => a.perCase.get(c)!.passed / a.perCase.get(c)!.trials;
        const compare = compareTargets(shared.map((caseId) => ({ caseId, a: rate(bestArm, caseId), b: rate(baseline, caseId) })), 1 - alpha);
        if (compare.paired.p < alpha && compare.paired.meanDiff > 0) verdict = `${best.id} beats baseline (+${(compare.paired.meanDiff * 100).toFixed(0)} pts over ${shared.length} shared cases, p=${compare.paired.p.toExponential(1)})`;
      }
    } else if (best) verdict = "baseline holds; no candidate beats it";
    const toCandidate = (r: OptimizeArm, all: OptimizeArm[]): Candidate => ({ id: r.id, text: r.id, passAt1: r.passAt1, lo: r.lo, hi: r.hi, costUsd: r.costUsd, pareto: !all.some((o) => o !== r && o.passAt1 >= r.passAt1 && o.costUsd <= r.costUsd && (o.passAt1 > r.passAt1 || o.costUsd < r.costUsd)) });
    const file: CandidatesFile = { schemaVersion: 1, kind: "optimize", baseline: toCandidate(report.find((r) => r.id === "baseline")!, report), candidates: report.filter((r) => r.id !== "baseline").map((r) => toCandidate(r, report)) };
    const dir = path.join(root, "optimize");
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${id}.json`);
    fs.writeFileSync(out, `${JSON.stringify({ ...file, arms: report, verdict, stopped, spent, verified }, null, 2)}\n`);
    return { id, file, arms: report, verdict, stopped, spent, verified, path: out };
  } finally {
    store.close();
  }
}
