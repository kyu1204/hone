import * as path from "node:path";
import { loadConfig } from "../../core/config";
import { Store } from "../../core/store";
import type { Trial } from "../../core/types";
import { type CompareRow, compareTargets } from "../../stats/paired";
import { ArgError, parseArgs, usageLine } from "../args";
import type { CommandIo } from "./run";

export const COMPARE_SPEC = {
  flags: ["json"],
  strings: ["run", "scorer"],
  numbers: ["alpha"],
  repeatable: ["run"],
} as const;

const HELP: Record<string, string> = {
  json: "print the comparison as JSON",
  run: "run id (once: compare two targets in it; twice: compare the same target across runs)",
  scorer: "compare mean score of this scorer instead of pass rate",
  alpha: "significance level (default 0.05)",
};

export function compareUsage(): string {
  return `usage: hone compare <targetA> <targetB> [--run id]\n       hone compare --run A --run B [<target>]\n\nPaired comparison per case with significance.\n\n${usageLine(COMPARE_SPEC, HELP)}\n`;
}

export async function storeRoot(io: CommandIo): Promise<string> {
  try {
    const { config } = await loadConfig(io.cwd);
    return path.resolve(io.cwd, config.cacheDir ?? ".hone");
  } catch {
    return path.resolve(io.cwd, ".hone");
  }
}

function valueOf(trials: Trial[], scorer?: string): number {
  if (scorer) {
    const vals = trials.flatMap((t) => t.scores.filter((s) => s.scorer === scorer).map((s) => s.value));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  return trials.filter((t) => t.pass === true).length / trials.length;
}

function byCase(trials: Trial[]): Map<string, Trial[]> {
  const m = new Map<string, Trial[]>();
  for (const t of trials) (m.get(t.trace.caseId) ?? m.set(t.trace.caseId, []).get(t.trace.caseId)!).push(t);
  return m;
}

export async function compareCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, COMPARE_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${compareUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(compareUsage());
    return 0;
  }
  const alpha = args.numbers.alpha ?? 0.05;
  const scorer = args.values.scorer?.[0];
  const store = new Store(await storeRoot(io));
  try {
    const runs = args.values.run ?? [];
    let sideA: { label: string; trials: Trial[] };
    let sideB: { label: string; trials: Trial[] };
    if (runs.length >= 2) {
      const target = args.positionals[0];
      const [ra, rb] = runs;
      sideA = { label: `${target ?? "all"}@${ra}`, trials: store.queryTrials({ runId: ra, ...(target ? { targetId: target } : {}) }) };
      sideB = { label: `${target ?? "all"}@${rb}`, trials: store.queryTrials({ runId: rb, ...(target ? { targetId: target } : {}) }) };
    } else {
      const [a, b] = args.positionals;
      if (!a || !b) {
        io.stderr(`two targets are required\n${compareUsage()}`);
        return 2;
      }
      const runId = runs[0] ?? store.listRuns(1)[0]?.id;
      if (!runId) {
        io.stderr("no runs found; run `hone test` first\n");
        return 2;
      }
      sideA = { label: a, trials: store.queryTrials({ runId, targetId: a }) };
      sideB = { label: b, trials: store.queryTrials({ runId, targetId: b }) };
    }
    for (const side of [sideA, sideB]) {
      if (side.trials.length === 0) {
        io.stderr(`no trials for ${side.label}\n`);
        return 2;
      }
    }
    const ca = byCase(sideA.trials);
    const cb = byCase(sideB.trials);
    const shared = [...ca.keys()].filter((id) => cb.has(id)).sort();
    const missing = ca.size + cb.size - 2 * shared.length;
    if (shared.length < 2) {
      io.stderr(`only ${shared.length} case(s) in common; need at least 2\n`);
      return 2;
    }
    const rows: CompareRow[] = shared.map((id) => {
      const row: CompareRow = { caseId: id, a: valueOf(ca.get(id)!, scorer), b: valueOf(cb.get(id)!, scorer) };
      const cluster = ca.get(id)![0]!.trace.meta?.cluster;
      if (typeof cluster === "string") row.cluster = cluster;
      return row;
    });
    const result = compareTargets(rows, 1 - alpha);
    const p = result.paired.p;
    const verdict = p < alpha ? (result.paired.meanDiff > 0 ? `${sideA.label} better` : `${sideB.label} better`) : "no significant difference";
    if (args.flags.json) {
      io.stdout(`${JSON.stringify({ schemaVersion: 1, a: sideA.label, b: sideB.label, alpha, scorer: scorer ?? null, rows, result, missing, verdict }, null, 2)}\n`);
      return 0;
    }
    const meanA = rows.reduce((s, r) => s + r.a, 0) / rows.length;
    const meanB = rows.reduce((s, r) => s + r.b, 0) / rows.length;
    const lines = [
      `compare ${sideA.label} vs ${sideB.label} on ${rows.length} cases (${scorer ? `scorer ${scorer}` : "pass rate"})`,
      `  ${sideA.label.padEnd(24)} mean ${meanA.toFixed(3)}`,
      `  ${sideB.label.padEnd(24)} mean ${meanB.toFixed(3)}`,
      `  difference ${result.paired.meanDiff >= 0 ? "+" : ""}${result.paired.meanDiff.toFixed(3)}  CI${Math.round((1 - alpha) * 100)}% [${result.paired.lo.toFixed(3)}, ${result.paired.hi.toFixed(3)}]  t=${result.paired.t.toFixed(2)}  p=${p.toExponential(2)}`,
      `  pairing reduced variance by ${(result.paired.varianceReduction * 100).toFixed(0)}% (corr ${result.paired.corr.toFixed(2)})`,
    ];
    if (result.mcnemar) lines.push(`  McNemar exact p=${result.mcnemar.p.toExponential(2)} (${result.mcnemar.b} cases only ${sideA.label}, ${result.mcnemar.c} only ${sideB.label})`);
    if (result.clustered) lines.push(`  cluster-robust CI [${result.clustered.lo.toFixed(3)}, ${result.clustered.hi.toFixed(3)}] over ${result.clustered.nClusters} clusters`);
    if (missing) lines.push(`  ${missing} case(s) present on one side only were dropped`);
    lines.push(`  verdict: ${verdict} at alpha ${alpha}`);
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  } finally {
    store.close();
  }
}
