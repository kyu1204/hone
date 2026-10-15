import { spinner } from "@clack/prompts";
import Table from "cli-table3";
import * as fs from "node:fs";
import * as path from "node:path";
import { Cache } from "../../core/cache";
import { ConfigNotFound, type HoneConfig, loadCases, loadConfig } from "../../core/config";
import { HoneEvents } from "../../core/events";
import { createExecutor } from "../../core/executor";
import { buildPlan, type Plan, type PlanFilter } from "../../core/plan";
import { type RunSummary, runPlan } from "../../core/scheduler";
import { Store } from "../../core/store";
import type { Trial, Verdict } from "../../core/types";
import { renderReport } from "../../io/export/html";
import { createScorers } from "../../scorers/index";
import { createTargets } from "../../targets/index";
import { ArgError, parseArgs, usageLine } from "../args";
import { bar, type Paint, paint } from "../paint";

export interface CommandIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
  /** Colors for a person at a terminal; see colorOn. */
  color?: boolean;
}

export const RUN_SPEC = {
  flags: ["adaptive", "cache", "quiet"],
  strings: ["target", "case", "tag", "json", "report"],
  numbers: ["trials", "ci-width", "max-trials", "concurrency", "max-cost"],
  repeatable: ["target", "case", "tag"],
  optionalValue: ["json", "report"],
} as const;

const RUN_HELP: Record<string, string> = {
  adaptive: "keep sampling cells until their confidence interval is narrow",
  cache: "use the content-addressed cache (default on; --no-cache to disable)",
  quiet: "no per-trial progress on stderr",
  target: "only this target id (repeatable, globs ok)",
  case: "only this case id (repeatable, globs ok)",
  tag: "only cases with this tag (repeatable)",
  json: "print the result document instead of the table (or write it to a path)",
  report: "also write a self-contained HTML report of this run (default report.html)",
  trials: "trials per case x target (default from config, else 3)",
  "ci-width": "adaptive: stop a cell when its Wilson interval is narrower than this",
  "max-trials": "adaptive: cap per cell",
  concurrency: "parallel trials",
  "max-cost": "abort when accumulated cost (USD) exceeds this",
};

export function runUsage(): string {
  return `usage: hone test [options]\n       hone test --ci [gate options]\n\nRun every case against every target, score, and summarise. With --ci: gate per axis for a pipeline (hone test --ci --help).\n\n${usageLine(RUN_SPEC, RUN_HELP)}\n`;
}

export interface GateResult {
  name: string;
  value: number;
  threshold: number;
  pass: boolean;
}

export function evaluateGates(config: HoneConfig, summary: RunSummary): GateResult[] {
  const g = config.gates ?? {};
  const out: GateResult[] = [];
  if (g.passAt1) out.push({ name: "passAt1", value: summary.totals.passAt1, threshold: g.passAt1.min, pass: summary.totals.passAt1 >= g.passAt1.min });
  if (g.passHatK) {
    const k = g.passHatK.k;
    const vals = summary.cells.map((c) => c.passHatK[k]).filter((v): v is number => v !== undefined);
    const value = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    out.push({ name: `passHatK[${k}]`, value, threshold: g.passHatK.min, pass: value >= g.passHatK.min });
  }
  if (g.costUsd) out.push({ name: "costUsd", value: summary.totals.costUsd, threshold: g.costUsd.max, pass: summary.totals.costUsd <= g.costUsd.max });
  return out;
}

const dots = (trials: Trial[], p: Paint): string => {
  const shown = trials.slice(0, 5).map((t) => (t.pass === true ? p.green("●") : t.pass === false ? p.red("○") : p.dim("○"))).join("");
  return trials.length > 5 ? `${shown}+` : shown;
};

export function renderMatrix(plan: Plan, summary: RunSummary, trials: Trial[], targetIds: string[], p: Paint = paint()): string {
  const caseIds = [...new Set(plan.cells.map((c) => c.caseId))];
  const byCell = new Map<string, Trial[]>();
  for (const t of trials) {
    const key = `${t.trace.caseId}\u0000${t.trace.targetId}`;
    (byCell.get(key) ?? byCell.set(key, []).get(key)!).push(t);
  }
  const verdict = (caseId: string, targetId: string): Verdict | undefined => summary.cells.find((v) => v.caseId === caseId && v.targetId === targetId);
  const caseWidth = Math.max(12, ...caseIds.map((c) => c.length)) + 2;
  const colWidth = 14;
  const lines: string[] = [];
  const cellText = (c: string, t: string, q: Paint): string => {
    const v = verdict(c, t);
    if (!v || v.n === 0) return q.dim("·");
    const cell = byCell.get(`${c}\u0000${t}`) ?? [];
    const flagged = cell.some((x) => x.flags.includes("reward-hack")) ? " ⚑" : "";
    return `${dots(cell, q)} ${q.rate(v.passAt1, v.passAt1.toFixed(2))}${q.yellow(flagged)}`;
  };
  if (p.on) {
    // a person at a terminal gets a bordered table
    const table = new Table({ head: ["case", ...targetIds].map((h) => p.bold(h)), style: { head: [], border: ["gray"] } });
    for (const c of caseIds) table.push([c, ...targetIds.map((t) => cellText(c, t, p))]);
    lines.push(table.toString());
  } else {
    lines.push(`${"case \\ target".padEnd(caseWidth)}${targetIds.map((t) => t.slice(0, colWidth - 1).padEnd(colWidth)).join("")}`);
    lines.push(`${"-".repeat(caseWidth - 1)} ${targetIds.map(() => `${"-".repeat(colWidth - 1)} `).join("")}`);
    for (const c of caseIds) lines.push(`${c.slice(0, caseWidth - 2).padEnd(caseWidth)}${targetIds.map((t) => cellText(c, t, p).padEnd(colWidth)).join("")}`);
  }
  const k3 = summary.cells.map((c) => c.passHatK[3]).filter((v): v is number => v !== undefined);
  const passHat3 = k3.length ? (k3.reduce((a, b) => a + b, 0) / k3.length).toFixed(2) : "n/a";
  const tokens = trials.reduce((a, t) => a + t.trace.usage.inputTokens + t.trace.usage.outputTokens, 0);
  const perSolve = summary.totals.passed ? Math.round(tokens / summary.totals.passed).toLocaleString("en-US") : "n/a";
  const flagged = Object.entries(summary.totals.flagged)
    .filter(([f]) => f !== "cached")
    .map(([f, n]) => `${n} ${f}`)
    .join(", ");
  lines.push("");
  const rate = summary.totals.passAt1;
  lines.push(`${p.bold("pass@1")} ${p.rate(rate, `${rate.toFixed(2)} ${bar(rate)}`)}   pass^3 ${passHat3}   trials ${summary.totals.trials} (${summary.totals.cached} cached)   cost $${summary.totals.costUsd.toFixed(4)}   tokens/solve ${perSolve}${flagged ? `   ${flagged}` : ""}`);
  return `${lines.join("\n")}\n`;
}

export interface RunOptions {
  cwd: string;
  filter?: PlanFilter;
  trials?: number;
  concurrency?: number;
  adaptive?: boolean;
  ciWidth?: number;
  maxTrials?: number;
  useCache?: boolean;
  maxCost?: number;
  quiet?: boolean;
  stderr: (s: string) => void;
  color?: boolean;
  /** Called for each finished trial in place of the progress line, e.g. to drive a spinner. */
  onTrial?: (trial: Trial, cached: boolean) => void;
}

export interface RunOutcome {
  config: HoneConfig;
  configHash: string;
  plan: Plan;
  summary: RunSummary;
  trials: Trial[];
  gates: GateResult[];
  runId: string;
  cost: number;
  targetIds: string[];
  storeRoot: string;
}

/** Thrown by performRun with the exit code the CLI should use. */
export class RunError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = "RunError";
  }
}

export async function performRun(opts: RunOptions): Promise<RunOutcome> {
  let loaded: Awaited<ReturnType<typeof loadConfig>>;
  try {
    loaded = await loadConfig(opts.cwd);
  } catch (e) {
    throw new RunError(e instanceof ConfigNotFound ? e.message : `config error: ${e instanceof Error ? e.message : String(e)}`, 2);
  }
  const config = loaded.config;
  const root = path.resolve(opts.cwd, config.cacheDir ?? ".hone");
  let cases;
  let targets;
  let scorers;
  try {
    cases = await loadCases(config.cases, opts.cwd);
    targets = createTargets(config.targets);
    scorers = createScorers(config.scorers);
  } catch (e) {
    throw new RunError(`config error: ${e instanceof Error ? e.message : String(e)}`, 2);
  }
  const effective: HoneConfig = { ...config };
  if (opts.trials !== undefined) effective.trials = opts.trials;
  if (opts.concurrency !== undefined) effective.concurrency = opts.concurrency;
  if (opts.adaptive) effective.adaptive = { ciWidth: opts.ciWidth ?? config.adaptive?.ciWidth ?? 0.2, maxTrials: opts.maxTrials ?? config.adaptive?.maxTrials ?? 12 };
  let plan: Plan;
  try {
    plan = buildPlan({ config: effective, cases, targets: Object.keys(targets), filter: opts.filter ?? {} });
  } catch (e) {
    throw new RunError(e instanceof Error ? e.message : String(e), 2);
  }

  const store = new Store(root);
  const cache = new Cache(path.join(root, "cache"));
  const events = new HoneEvents();
  const run = store.createRun({ configHash: loaded.hash, targets: Object.keys(targets), caseIds: cases.map((c) => c.id) });
  const ctrl = new AbortController();
  const trials: Trial[] = [];
  let cost = 0;
  events.on("trial:done", ({ trial, cached }) => {
    trials.push(trial);
    cost += trial.costUsd;
    if (opts.maxCost !== undefined && cost > opts.maxCost) ctrl.abort();
    const p = paint(opts.color);
    if (opts.onTrial) opts.onTrial(trial, cached);
    else if (!opts.quiet) opts.stderr(`${trial.pass === true ? p.green("✓") : trial.pass === false ? p.red("✗") : "·"} ${trial.trace.caseId} ${p.dim(`${trial.trace.targetId} #${trial.trace.trial}${cached ? " (cached)" : ""} $${trial.costUsd.toFixed(4)}`)}\n`);
  });
  const execute = createExecutor({ targets, scorers, scorerSpecs: config.scorers, cases, cache, store, events, gates: config.gates, runId: run.id, useCache: opts.useCache ?? true, signal: ctrl.signal });
  const summary = await runPlan(plan, { runId: run.id, execute, events, signal: ctrl.signal });
  store.finishRun(run.id, summary as unknown as Record<string, unknown>);
  for (const t of Object.values(targets)) await t.close?.();
  store.close();
  return { config, configHash: loaded.hash, plan, summary, trials, gates: evaluateGates(config, summary), runId: run.id, cost, targetIds: [...new Set(plan.cells.map((c) => c.targetId))], storeRoot: root };
}

/** A spinner on stderr that counts trials as they finish. */
function spinnerProgress(): { onTrial: (t: Trial, cached: boolean) => void; done: () => void } {
  const p = paint(true);
  const s = spinner({ output: process.stderr });
  let n = 0;
  let pass = 0;
  let fail = 0;
  let cost = 0;
  const started = Date.now();
  const line = () => `${n} trials   ${p.green(`✓ ${pass}`)}   ${p.red(`✗ ${fail}`)}   ${p.dim(`$${cost.toFixed(4)}`)}`;
  s.start("running the cases");
  let open = true;
  return {
    onTrial: (t) => {
      n++;
      if (t.pass === true) pass++;
      else if (t.pass === false) fail++;
      cost += t.costUsd;
      s.message(line());
    },
    done: () => {
      if (!open) return;
      open = false;
      s.stop(`${line()}   ${p.dim(`${((Date.now() - started) / 1000).toFixed(1)}s`)}`);
    },
  };
}

export async function runCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, RUN_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${runUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(runUsage());
    return 0;
  }
  const filter: PlanFilter = {};
  if (args.values.target) filter.targets = args.values.target;
  if (args.values.case) filter.cases = args.values.case;
  if (args.values.tag) filter.tags = args.values.tag;
  const progress = io.color && !args.flags.quiet && process.stderr.isTTY ? spinnerProgress() : undefined;
  let outcome: RunOutcome;
  try {
    outcome = await performRun({
      cwd: io.cwd,
      filter,
      trials: args.numbers.trials,
      concurrency: args.numbers.concurrency,
      adaptive: args.flags.adaptive,
      ciWidth: args.numbers["ci-width"],
      maxTrials: args.numbers["max-trials"],
      useCache: args.flags.cache !== false,
      maxCost: args.numbers["max-cost"],
      quiet: args.flags.quiet,
      stderr: io.stderr,
      color: io.color,
      onTrial: progress?.onTrial,
    });
    progress?.done();
  } catch (e) {
    progress?.done();
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n`);
    return e instanceof RunError ? e.code : 2;
  }
  const { summary, trials, gates, runId, cost, plan, targetIds } = outcome;
  if (args.values.json) {
    const doc = JSON.stringify({ schemaVersion: 1, runId, summary, cells: summary.cells, gates, trialIds: trials.map((t) => t.id) }, null, 2);
    const target = args.values.json[0];
    if (target) fs.writeFileSync(path.resolve(io.cwd, target), doc);
    else io.stdout(`${doc}\n`);
  } else io.stdout(renderMatrix(plan, summary, trials, targetIds, paint(io.color)));
  if (args.values.report) {
    const out = path.resolve(io.cwd, args.values.report[0] || "report.html");
    fs.writeFileSync(out, renderReport(runId, trials, summary as unknown as Record<string, unknown>));
    io.stdout(`wrote ${out} (${trials.length} trials)\n`);
  }

  if (summary.aborted) {
    io.stderr(`aborted: cost $${cost.toFixed(4)} exceeded --max-cost\n`);
    return 3;
  }
  const failed = gates.find((g) => !g.pass);
  if (failed) {
    io.stderr(`gate ${failed.name} failed: ${failed.value.toFixed(3)} vs threshold ${failed.threshold}\n`);
    return 1;
  }
  return 0;
}
