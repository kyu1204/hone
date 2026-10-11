import { Store } from "../../core/store";
import type { Trial } from "../../core/types";
import { leaderboard } from "../../stats/holm";
import { verdictFor } from "../../stats/passk";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const MATRIX_SPEC = { flags: ["json"], strings: ["run", "by"], numbers: [], repeatable: [] } as const;
const HELP: Record<string, string> = { json: "print rows as JSON", run: "run id (default: latest)", by: "group by target (default), model or agent (from trace.meta)" };

export function matrixUsage(): string {
  return `usage: hone matrix [--run id] [--by target|model|agent] [--json]\n\nPer-target solve rate, cost, tokens and time per solve, flags, and significance bands.\n\n${usageLine(MATRIX_SPEC, HELP)}\n`;
}

export interface MatrixRow {
  id: string;
  cases: number;
  trials: number;
  passed: number;
  passAt1: number;
  passHat3: number | null;
  costPerSolve: number | null;
  tokensPerSolve: number | null;
  msPerSolve: number | null;
  timeouts: number;
  rewardHacks: number;
  cachedShare: number;
  band: string;
}

export function buildMatrix(trials: Trial[], by: "target" | "model" | "agent"): MatrixRow[] {
  const groups = new Map<string, Trial[]>();
  for (const t of trials) {
    const key = by === "target" ? t.trace.targetId : String(t.trace.meta?.[by] ?? "unknown");
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const rows: MatrixRow[] = [];
  const perCase = new Map<string, Map<string, number>>();
  for (const [id, ts] of groups) {
    const cells = new Map<string, boolean[]>();
    for (const t of ts) (cells.get(t.trace.caseId) ?? cells.set(t.trace.caseId, []).get(t.trace.caseId)!).push(t.pass === true);
    const k3 = [...cells.entries()].map(([c, o]) => verdictFor(c, id, o).passHatK[3]).filter((v): v is number => v !== undefined);
    const passed = ts.filter((t) => t.pass === true).length;
    const tokens = ts.reduce((a, t) => a + t.trace.usage.inputTokens + t.trace.usage.outputTokens, 0);
    const ms = ts.reduce((a, t) => a + (Date.parse(t.trace.endedAt) - Date.parse(t.trace.startedAt)), 0);
    const cost = ts.reduce((a, t) => a + t.costUsd, 0);
    perCase.set(id, new Map([...cells.entries()].map(([c, o]) => [c, o.filter(Boolean).length / o.length])));
    rows.push({
      id,
      cases: cells.size,
      trials: ts.length,
      passed,
      passAt1: passed / ts.length,
      passHat3: k3.length ? k3.reduce((a, b) => a + b, 0) / k3.length : null,
      costPerSolve: passed ? cost / passed : null,
      tokensPerSolve: passed ? tokens / passed : null,
      msPerSolve: passed ? ms / passed : null,
      timeouts: ts.filter((t) => t.flags.includes("timeout")).length,
      rewardHacks: ts.filter((t) => t.flags.includes("reward-hack")).length,
      cachedShare: ts.filter((t) => t.flags.includes("cached")).length / ts.length,
      band: "A",
    });
  }
  // Bands: leaderboard groups over case-aligned pass rates.
  const ids = rows.map((r) => r.id);
  const shared = ids.length ? [...perCase.get(ids[0]!)!.keys()].filter((c) => ids.every((id) => perCase.get(id)!.has(c))) : [];
  if (ids.length >= 2 && shared.length >= 3) {
    const scores = Object.fromEntries(ids.map((id) => [id, shared.map((c) => perCase.get(id)!.get(c)!)]));
    const lb = leaderboard(scores);
    const letter = new Map<string, string>();
    lb.groups.forEach((g, i) => {
      for (const id of g) if (!letter.has(id)) letter.set(id, String.fromCharCode(65 + Math.min(25, i)));
    });
    for (const r of rows) r.band = letter.get(r.id) ?? "A";
  }
  rows.sort((a, b) => b.passAt1 - a.passAt1 || (a.costPerSolve ?? Number.POSITIVE_INFINITY) - (b.costPerSolve ?? Number.POSITIVE_INFINITY));
  return rows;
}

const fmt = (n: number | null, digits = 2, prefix = ""): string => (n === null ? "n/a" : `${prefix}${n.toFixed(digits)}`);
const fmtInt = (n: number | null): string => (n === null ? "n/a" : Math.round(n).toLocaleString("en-US"));

export function renderMatrixRows(rows: MatrixRow[]): string {
  const idWidth = Math.max(8, ...rows.map((r) => r.id.length)) + 2;
  const head = `${"target".padEnd(idWidth)}band  cases  trials  pass@1  pass^3  $/solve   tokens/solve  s/solve  timeouts  hacks  cached`;
  const lines = rows.map(
    (r) =>
      `${r.id.padEnd(idWidth)}${r.band.padEnd(6)}${String(r.cases).padEnd(7)}${String(r.trials).padEnd(8)}${r.passAt1.toFixed(2).padEnd(8)}${fmt(r.passHat3).padEnd(8)}${fmt(r.costPerSolve, 4, "$").padEnd(10)}${fmtInt(r.tokensPerSolve).padEnd(14)}${fmt(r.msPerSolve === null ? null : r.msPerSolve / 1000, 1).padEnd(9)}${String(r.timeouts).padEnd(10)}${String(r.rewardHacks).padEnd(7)}${(r.cachedShare * 100).toFixed(0)}%`,
  );
  return `${[head, ...lines].join("\n")}\n\nband: targets sharing a letter are not significantly different (Holm-adjusted paired tests).\n`;
}

export async function matrixCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, MATRIX_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${matrixUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(matrixUsage());
    return 0;
  }
  const by = (args.values.by?.[0] ?? "target") as "target" | "model" | "agent";
  if (!["target", "model", "agent"].includes(by)) {
    io.stderr(`--by must be target, model or agent\n`);
    return 2;
  }
  const store = new Store(await storeRoot(io));
  try {
    const runId = args.values.run?.[0] ?? store.listRuns(1)[0]?.id;
    if (!runId) {
      io.stderr("no runs found; run `hone run` first\n");
      return 2;
    }
    const trials = store.queryTrials({ runId });
    if (trials.length === 0) {
      io.stderr(`no trials in run ${runId}\n`);
      return 2;
    }
    const rows = buildMatrix(trials, by);
    if (args.flags.json) io.stdout(`${JSON.stringify({ schemaVersion: 1, runId, by, rows }, null, 2)}\n`);
    else io.stdout(`run ${runId} by ${by}\n\n${renderMatrixRows(rows)}`);
    return 0;
  } finally {
    store.close();
  }
}
