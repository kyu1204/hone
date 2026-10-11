import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../../core/store";
import { CLAUDE_CODE_TARGET, defaultProjectDir, importClaudeSessions } from "../../io/import/claudeCode";
import type { Imported } from "../../io/import/common";
import { importDocent } from "../../io/import/docent";
import { importHarbor } from "../../io/import/harbor";
import { importInspect, parseInspectJson } from "../../io/import/inspect";
import { importOtel } from "../../io/import/otel";
import { importPluginEval } from "../../io/import/pluginEval";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const IMPORT_SPEC = { flags: ["json"], strings: ["project", "since", "cases", "target"], numbers: ["limit"], repeatable: [] } as const;
const HELP: Record<string, string> = { project: "Claude Code project directory (default ~/.claude/projects/<dashed cwd>)", limit: "newest N sessions (claude-code)", since: "only sessions modified on or after this date (claude-code)", cases: "also write the imported cases to this JSONL path", target: "target id to record instead of the one in the file", json: "print the result as JSON" };
const KINDS = ["claude-code", "inspect", "docent", "plugin-eval", "harbor", "otel"];

export function importUsage(): string {
  return `usage: hone import claude-code [session.jsonl...] [--project dir] [--limit n] [--since date] [--cases cases.jsonl] [--json]\n       hone import inspect|docent|otel <file.json> [--target id] [--cases cases.jsonl] [--json]\n       hone import harbor <trial-or-job-dir> [--target id] [--json]\n       hone import plugin-eval <case-dir> [--cases cases.jsonl] [--json]\n\nBring other tools' results into the store: one run per import (plugin-eval yields cases and scorer specs only).\n\n${usageLine(IMPORT_SPEC, HELP)}\n`;
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
  if (kind !== "claude-code") return importOther(kind, paths, args, io);
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

function writeCases(io: CommandIo, file: string | undefined, cases: Imported["cases"]): void {
  if (!file) return;
  fs.writeFileSync(path.resolve(io.cwd, file), `${cases.map((c) => JSON.stringify(c)).join("\n")}\n`);
}

async function importOther(kind: string, paths: string[], args: ReturnType<typeof parseArgs>, io: CommandIo): Promise<number> {
  const src = paths[0];
  if (!src || !fs.existsSync(src)) {
    io.stderr(`hone import ${kind} needs an existing ${kind === "harbor" || kind === "plugin-eval" ? "directory" : "file"}\n${importUsage()}`);
    return 2;
  }
  const target = args.values.target?.[0];
  if (kind === "plugin-eval") {
    try {
      const r = importPluginEval(src);
      writeCases(io, args.values.cases?.[0], r.cases);
      if (args.flags.json) io.stdout(`${JSON.stringify({ cases: r.cases, scorers: r.scorers }, null, 2)}\n`);
      else io.stdout(`${r.cases.length} case${r.cases.length === 1 ? "" : "s"} from ${src}${args.values.cases?.[0] ? ` written to ${args.values.cases[0]}` : ""}\n\nscorers for hone.config.ts:\n${JSON.stringify(r.scorers, null, 2)}\n`);
      return 0;
    } catch (e) {
      io.stderr(`import failed: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }
  const store = new Store(await storeRoot(io));
  try {
    const run = store.createRun({ configHash: "imported", targets: [], caseIds: [] });
    let r: Imported;
    try {
      if (kind === "harbor") r = importHarbor(src, { runId: run.id, target });
      else {
        const text = fs.readFileSync(src, "utf8");
        r = kind === "inspect" ? importInspect(parseInspectJson(text), { runId: run.id, target }) : kind === "docent" ? importDocent(JSON.parse(text), { runId: run.id, target }) : importOtel(JSON.parse(text), { runId: run.id, target });
      }
    } catch (e) {
      io.stderr(`import failed: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    for (const t of r.trials) store.saveTrial(t);
    const targets = [...new Set(r.trials.map((t) => t.trace.targetId))];
    const passed = r.trials.filter((t) => t.pass === true).length;
    const costUsd = r.trials.reduce((s, t) => s + t.costUsd, 0);
    store.finishRun(run.id, { imported: kind, source: path.resolve(src), targets, caseIds: r.cases.map((c) => c.id), totals: { trials: r.trials.length, passed, passAt1: r.trials.length ? passed / r.trials.length : 0, costUsd } });
    writeCases(io, args.values.cases?.[0], r.cases);
    if (args.flags.json) io.stdout(`${JSON.stringify({ runId: run.id, cases: r.cases, trialIds: r.trials.map((t) => t.id), targets }, null, 2)}\n`);
    else io.stdout(`imported ${r.trials.length} trial${r.trials.length === 1 ? "" : "s"} over ${r.cases.length} case${r.cases.length === 1 ? "" : "s"} (${targets.join(", ")}) from ${src} into run ${run.id}; ${passed} passed\n`);
    return 0;
  } finally {
    store.close();
  }
}
