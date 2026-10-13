import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "../../core/store";
import type { Trial } from "../../core/types";
import { pairedDifference } from "../../stats/paired";
import { junitXml } from "../../io/export/junit";
import { ArgError, parseArgs, usageLine } from "../args";
import type { PlanFilter } from "../../core/plan";
import { type CommandIo, type GateResult, performRun, RunError, type RunOutcome } from "./run";

export const CI_SPEC = {
  flags: ["quiet", "cache", "comment", "adaptive"],
  strings: ["baseline", "junit", "json", "target", "case", "tag", "min-pass-hat-k", "pr"],
  numbers: ["min-pass-at-1", "max-cost", "max-regression", "trials", "concurrency"],
  repeatable: ["target", "case", "tag"],
} as const;

const HELP: Record<string, string> = {
  quiet: "no per-trial progress",
  cache: "use the cache (default on)",
  comment: "post a markdown summary as a PR comment (gh) or print it",
  adaptive: "adaptive sampling",
  baseline: "run id to measure regression against",
  junit: "write JUnit XML to this path",
  json: "write the gate document to this path (always written to .hone/ci/last.json)",
  target: "only this target (repeatable)",
  case: "only this case (repeatable)",
  tag: "only cases with this tag",
  "min-pass-hat-k": "k:min, e.g. 3:0.8",
  pr: "pull request number for --comment",
  "min-pass-at-1": "gate on pass@1",
  "max-cost": "gate on total cost (USD)",
  "max-regression": "gate on pass@1 drop vs --baseline (paired by case)",
  trials: "trials per cell",
  concurrency: "parallel trials",
};

export function ciUsage(): string {
  return `usage: hone test --ci [options]\n\nRun, check per-axis gates, exit non-zero on the failing axis, leave artifacts.\n\n${usageLine(CI_SPEC, HELP)}\n`;
}

function perCasePass(trials: Trial[]): Map<string, number> {
  const by = new Map<string, Trial[]>();
  for (const t of trials) (by.get(t.trace.caseId) ?? by.set(t.trace.caseId, []).get(t.trace.caseId)!).push(t);
  return new Map([...by].map(([c, ts]) => [c, ts.filter((t) => t.pass === true).length / ts.length]));
}

export function regressionGate(current: Trial[], baseline: Trial[], maxRegression: number): GateResult {
  const cur = perCasePass(current);
  const base = perCasePass(baseline);
  const shared = [...cur.keys()].filter((c) => base.has(c));
  if (shared.length < 2) return { name: "regression", value: 0, threshold: maxRegression, pass: true };
  const d = pairedDifference(shared.map((c) => base.get(c)!), shared.map((c) => cur.get(c)!));
  const drop = d.meanDiff; // baseline minus current: positive means we got worse
  return { name: "regression", value: drop, threshold: maxRegression, pass: drop <= maxRegression };
}


export function commentMarkdown(outcome: RunOutcome, gates: GateResult[]): string {
  const t = outcome.summary.totals;
  const rows = gates.map((g) => `| ${g.name} | ${g.value.toFixed(3)} | ${g.name === "costUsd" || g.name === "regression" ? "<=" : ">="} ${g.threshold} | ${g.pass ? "✅" : "❌"} |`);
  return `### hone test --ci: ${gates.every((g) => g.pass) ? "all gates passed ✅" : "gate failed ❌"}\n\nrun \`${outcome.runId}\`: pass@1 **${t.passAt1.toFixed(2)}**, ${t.trials} trials, $${t.costUsd.toFixed(4)}${t.flagged["reward-hack"] ? `, ${t.flagged["reward-hack"]} reward-hack flag(s)` : ""}\n\n| gate | value | threshold | result |\n|---|---|---|---|\n${rows.join("\n")}\n`;
}

export async function ciCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, CI_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${ciUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(ciUsage());
    return 0;
  }
  let hatK: { k: number; min: number } | undefined;
  if (args.values["min-pass-hat-k"]) {
    const [k, min] = args.values["min-pass-hat-k"][0]!.split(":").map(Number);
    if (!k || !Number.isInteger(k) || min === undefined || !Number.isFinite(min)) {
      io.stderr("--min-pass-hat-k expects k:min, e.g. 3:0.8\n");
      return 2;
    }
    hatK = { k, min };
  }
  const filter: PlanFilter = {};
  if (args.values.target) filter.targets = args.values.target;
  if (args.values.case) filter.cases = args.values.case;
  if (args.values.tag) filter.tags = args.values.tag;
  let outcome: RunOutcome;
  try {
    outcome = await performRun({ cwd: io.cwd, filter, trials: args.numbers.trials, concurrency: args.numbers.concurrency, adaptive: args.flags.adaptive, useCache: args.flags.cache !== false, quiet: args.flags.quiet, stderr: io.stderr });
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n`);
    return e instanceof RunError ? e.code : 2;
  }
  const gates: GateResult[] = [...outcome.gates];
  const t = outcome.summary.totals;
  if (args.numbers["min-pass-at-1"] !== undefined) gates.push({ name: "passAt1", value: t.passAt1, threshold: args.numbers["min-pass-at-1"], pass: t.passAt1 >= args.numbers["min-pass-at-1"] });
  if (hatK) {
    const vals = outcome.summary.cells.map((c) => c.passHatK[hatK.k]).filter((v): v is number => v !== undefined);
    const value = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    gates.push({ name: `passHatK[${hatK.k}]`, value, threshold: hatK.min, pass: value >= hatK.min });
  }
  if (args.numbers["max-cost"] !== undefined) gates.push({ name: "costUsd", value: t.costUsd, threshold: args.numbers["max-cost"], pass: t.costUsd <= args.numbers["max-cost"] });
  if (args.values.baseline) {
    const store = new Store(outcome.storeRoot);
    const baseline = store.queryTrials({ runId: args.values.baseline[0]! });
    store.close();
    if (baseline.length === 0) {
      io.stderr(`baseline run ${args.values.baseline[0]} has no trials\n`);
      return 2;
    }
    gates.push(regressionGate(outcome.trials, baseline, args.numbers["max-regression"] ?? 0));
  }

  const doc = { schemaVersion: 1, runId: outcome.runId, gates, summary: outcome.summary };
  const ciDir = path.join(outcome.storeRoot, "ci");
  fs.mkdirSync(ciDir, { recursive: true });
  fs.writeFileSync(path.join(ciDir, "last.json"), JSON.stringify(doc, null, 2));
  if (args.values.json?.[0]) fs.writeFileSync(path.resolve(io.cwd, args.values.json[0]), JSON.stringify(doc, null, 2));
  if (args.values.junit?.[0]) fs.writeFileSync(path.resolve(io.cwd, args.values.junit[0]), junitXml(outcome.trials, { durationMs: outcome.summary.totals.durationMs }));

  for (const g of gates) io.stdout(`${g.pass ? "✓" : "✗"} ${g.name} ${g.value.toFixed(3)} (threshold ${g.threshold})\n`);
  if (args.flags.comment) {
    const md = commentMarkdown(outcome, gates);
    const pr = args.values.pr?.[0] ?? /refs\/pull\/(\d+)/.exec(io.env.GITHUB_REF ?? "")?.[1];
    if (io.env.GITHUB_ACTIONS && pr) {
      const r = Bun.spawnSync(["gh", "pr", "comment", pr, "--body", md], { stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) io.stderr(`gh pr comment failed: ${r.stderr.toString().trim()}\n`);
    } else io.stdout(`${md}\n`);
  }
  const failed = gates.find((g) => !g.pass);
  if (failed) {
    io.stderr(`gate ${failed.name} failed: ${failed.value.toFixed(3)} vs threshold ${failed.threshold}\n`);
    return 1;
  }
  return 0;
}
