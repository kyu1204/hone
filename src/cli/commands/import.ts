import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../../core/store";
import { CLAUDE_CODE_TARGET, defaultProjectDir, importClaudeSessions } from "../../io/import/claudeCode";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const IMPORT_SPEC = { flags: ["json"], strings: ["project", "since", "cases"], numbers: ["limit"], repeatable: [] } as const;
const HELP: Record<string, string> = { project: "Claude Code project directory (default ~/.claude/projects/<dashed cwd>)", limit: "newest N sessions", since: "only sessions modified on or after this date", cases: "also write the mined cases to this JSONL path", json: "print the result as JSON" };
const KINDS = ["claude-code", "inspect", "docent", "plugin-eval", "harbor", "otel"];

export function importUsage(): string {
  return `usage: hone import claude-code [session.jsonl...] [--project dir] [--limit n] [--since date] [--cases cases.jsonl] [--json]\n\nMine Claude Code sessions into cases and traces so they show up in the matrix. Other kinds (${KINDS.slice(1).join(", ")}) arrive with T-802.\n\n${usageLine(IMPORT_SPEC, HELP)}\n`;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function importCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, IMPORT_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${importUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(importUsage());
    return 0;
  }
  const [kind, ...paths] = args.positionals;
  if (!kind || !KINDS.includes(kind)) {
    io.stderr(`import kind required: ${KINDS.join(", ")}\n${importUsage()}`);
    return 2;
  }
  if (kind !== "claude-code") {
    io.stderr(`hone import ${kind} is not yet available (T-802)\n`);
    return 2;
  }
  const since = args.values.since?.[0] ? new Date(args.values.since[0]) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    io.stderr(`--since must be a date, got ${args.values.since![0]}\n`);
    return 2;
  }
  const files = paths.filter((p) => fs.existsSync(p) && fs.statSync(p).isFile()).map((p) => path.resolve(io.cwd, p));
  const dirsGiven = paths.filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
  const dir = args.values.project?.[0] ?? dirsGiven[0] ?? (files.length ? undefined : defaultProjectDir(io.cwd, io.env.HOME ?? os.homedir()));
  const store = new Store(await storeRoot(io));
  try {
    const run = store.createRun({ configHash: "imported", targets: [CLAUDE_CODE_TARGET], caseIds: [] });
    const result = importClaudeSessions({ dir, files, limit: args.numbers.limit, since, runId: run.id });
    if (result.cases.length === 0) {
      io.stderr(`no sessions with a human prompt found in ${dir ?? files.join(", ")}${result.skipped ? ` (${result.skipped} skipped)` : ""}\n`);
      return 1;
    }
    for (const t of result.trials) store.saveTrial(t);
    const costUsd = result.trials.reduce((s, t) => s + t.costUsd, 0);
    store.finishRun(run.id, { imported: "claude-code", source: dir ?? files, caseIds: result.cases.map((c) => c.id), totals: { trials: result.trials.length, passed: 0, passAt1: 0, costUsd } });
    if (args.values.cases?.[0]) {
      const out = path.resolve(io.cwd, args.values.cases[0]);
      fs.writeFileSync(out, `${result.cases.map((c) => JSON.stringify(c)).join("\n")}\n`);
    }
    if (args.flags.json) {
      io.stdout(`${JSON.stringify({ runId: run.id, cases: result.cases, trialIds: result.trials.map((t) => t.id), skipped: result.skipped, files: result.files }, null, 2)}\n`);
      return 0;
    }
    const lines = ["  case      branch            turns  tools                      cost      first prompt"];
    for (const t of result.trials) {
      const c = result.cases.find((x) => x.id === t.trace.caseId)!;
      const tools = [...new Set(t.trace.messages.flatMap((m) => m.tool_calls?.map((x) => x.function.name) ?? []))].join(", ");
      lines.push(`  ${t.trace.caseId.padEnd(9)} ${clip(String(t.trace.meta?.gitBranch ?? "-"), 16).padEnd(17)} ${String(t.trace.meta?.turns ?? 1).padStart(5)}  ${clip(tools || "-", 26).padEnd(26)} $${t.costUsd.toFixed(4)}  ${clip(String(c.input).replace(/\s+/g, " "), 50)}`);
    }
    lines.push("", `imported ${result.trials.length} session${result.trials.length === 1 ? "" : "s"} into run ${run.id}${result.skipped ? ` (${result.skipped} without a prompt skipped)` : ""}${args.values.cases?.[0] ? `; cases written to ${args.values.cases[0]}` : ""}`);
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  } finally {
    store.close();
  }
}
