// Import Claude Code session JSONL (~/.claude/projects/<dashed cwd>/<session>.jsonl) as cases and traces.
import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "../../core/store";
import type { Artifacts, Case, Trial } from "../../core/types";
import { parseNdjson, recordsToParsed } from "../../targets/parsers/claudeCode";

export const CLAUDE_CODE_TARGET = "claude-code";

export interface SessionImport {
  case: Case;
  trial: Trial;
}

type Rec = Record<string, unknown>;
const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);

function humanText(rec: Rec): string | undefined {
  if (rec.type !== "user" || rec.isMeta || rec.isSidechain) return undefined;
  const content = (rec.message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content.trim() || undefined;
  if (Array.isArray(content)) {
    const texts = content.filter((b): b is { type: string; text?: string } => typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text").map((b) => b.text ?? "");
    const joined = texts.join("\n").trim();
    return joined || undefined;
  }
  return undefined;
}

function artifactsFrom(records: Rec[]): Artifacts | undefined {
  const diff: string[] = [];
  const files: Record<string, string> = {};
  let size = 0;
  for (const rec of records) {
    if (rec.type !== "assistant") continue;
    const blocks = (rec.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
      if (b.type !== "tool_use" || !b.input) continue;
      const file = str(b.input.file_path) ?? str(b.input.path);
      if (b.name === "Edit" && file && typeof b.input.old_string === "string" && typeof b.input.new_string === "string") {
        const chunk = `--- ${file}\n${b.input.old_string.split("\n").map((l) => `- ${l}`).join("\n")}\n${b.input.new_string.split("\n").map((l) => `+ ${l}`).join("\n")}\n`;
        size += chunk.length;
        if (size <= 200_000) diff.push(chunk);
      } else if (b.name === "Write" && file && typeof b.input.content === "string") {
        size += b.input.content.length;
        if (size <= 200_000) files[file] = b.input.content;
      }
    }
  }
  if (!diff.length && !Object.keys(files).length) return undefined;
  return { ...(diff.length ? { diff: diff.join("") } : {}), ...(Object.keys(files).length ? { files } : {}) };
}

/** One session -> one case (first human prompt) and one trace; undefined when the session has no human prompt. */
export function parseSession(text: string, runId = "imported"): SessionImport | undefined {
  const records = parseNdjson(text);
  const turns = records.map(humanText).filter((t): t is string => t !== undefined);
  if (turns.length === 0) return undefined;
  const first = records.find((r) => humanText(r) !== undefined)!;
  const sessionId = str(first.sessionId) ?? "session";
  const caseId = sessionId.slice(0, 8);
  const parsed = recordsToParsed(records.filter((r) => r.type === "user" || r.type === "assistant"), { humanTurns: true });
  const stamps = records.map((r) => str(r.timestamp)).filter((t): t is string => t !== undefined && !Number.isNaN(Date.parse(t)));
  const startedAt = str(first.timestamp) ?? stamps[0] ?? new Date().toISOString();
  const endedAt = stamps.at(-1) ?? startedAt;
  const cost = records.find((r) => r.type === "cost-state");
  const costUsd = typeof cost?.totalCostUSD === "number" ? cost.totalCostUSD : (parsed.usage.costUsd ?? 0);
  const model = records.map((r) => str((r.message as { model?: unknown } | undefined)?.model)).find((m) => m !== undefined);
  const branch = str(first.gitBranch);
  const meta: Record<string, unknown> = { ...parsed.meta, sessionId, cwd: first.cwd, gitBranch: branch, claudeVersion: first.version, model, turns: turns.length };
  const artifacts = artifactsFrom(records);
  const trial: Trial = {
    id: Store.trialId(runId, caseId, CLAUDE_CODE_TARGET, 0),
    runId,
    trace: { id: `${sessionId}-0`, caseId, targetId: CLAUDE_CODE_TARGET, trial: 0, startedAt, endedAt, messages: parsed.messages, spans: parsed.spans, output: parsed.output, usage: { inputTokens: parsed.usage.inputTokens ?? 0, outputTokens: parsed.usage.outputTokens ?? 0, costUsd }, meta, ...(artifacts ? { artifacts } : {}) },
    scores: [],
    flags: [],
    pass: null,
    costUsd,
  };
  const c: Case = { id: caseId, input: turns[0]!, tags: ["claude-code", ...(branch ? [branch] : [])], meta: { sessionId, cwd: first.cwd, startedAt } };
  return { case: c, trial };
}

export interface ImportOptions {
  dir?: string;
  files?: string[];
  limit?: number;
  since?: Date;
  runId?: string;
}

export function importClaudeSessions(opts: ImportOptions): { cases: Case[]; trials: Trial[]; skipped: number; files: string[] } {
  let files = opts.files ?? [];
  if (opts.dir) {
    const found = fs.existsSync(opts.dir) ? fs.readdirSync(opts.dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(opts.dir!, f)) : [];
    files = [...files, ...found];
  }
  files = files
    .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
    .filter((x) => !opts.since || x.mtime >= opts.since.getTime())
    .sort((a, b) => b.mtime - a.mtime)
    .map((x) => x.f);
  const cases: Case[] = [];
  const trials: Trial[] = [];
  let skipped = 0;
  const used: string[] = [];
  for (const f of files) {
    if (opts.limit !== undefined && cases.length >= opts.limit) break;
    const s = parseSession(fs.readFileSync(f, "utf8"), opts.runId);
    if (!s) {
      skipped++;
      continue;
    }
    cases.push(s.case);
    trials.push(s.trial);
    used.push(f);
  }
  return { cases, trials, skipped, files: used };
}

/** ~/.claude/projects/<cwd with every non [A-Za-z0-9-] replaced by "-"> */
export function defaultProjectDir(cwd: string, home: string): string {
  return path.join(home, ".claude", "projects", cwd.replace(/[^A-Za-z0-9-]/g, "-"));
}
