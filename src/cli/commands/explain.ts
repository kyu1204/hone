import { pickSibling, rankBranchPoints, topSteps } from "../../analysis/branchpoints";
import { Store } from "../../core/store";
import type { ChatMessage, Span, Trial } from "../../core/types";
import { ArgError, parseArgs } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const EXPLAIN_SPEC = { flags: ["json"], strings: [], numbers: ["width"], repeatable: [] } as const;

export function explainUsage(): string {
  return "usage: hone explain <trialId> [--json] [--width n]\n\nPrint one trial: verdict, scores with reasons, messages and spans.\n";
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const text = (x: unknown): string => (typeof x === "string" ? x : JSON.stringify(x ?? ""));

export function renderMessage(m: ChatMessage, width: number): string {
  const body = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ");
  const calls = m.tool_calls?.map((c) => `${c.function.name}(${clip(c.function.arguments, Math.max(20, width - c.function.name.length - 4))})`).join(", ");
  const head = m.role === "tool" ? `tool${m.name ? ` ${m.name}` : ""}${m.tool_call_id ? ` [${m.tool_call_id}]` : ""}` : m.role;
  return `  ${head.padEnd(12)} ${clip(body.replace(/\s+/g, " "), width)}${calls ? `${body ? " " : ""}→ ${calls}` : ""}`;
}

export function renderSpans(spans: Span[], width: number): string[] {
  const children = new Map<string | undefined, Span[]>();
  for (const s of spans) (children.get(s.parentId) ?? children.set(s.parentId, []).get(s.parentId)!).push(s);
  const lines: string[] = [];
  const walk = (parent: string | undefined, depth: number): void => {
    for (const s of children.get(parent) ?? []) {
      const ms = s.endedAt ? Date.parse(s.endedAt) - Date.parse(s.startedAt) : undefined;
      const err = s.attrs?.error ? ` error=${clip(text(s.attrs.error), 60)}` : "";
      lines.push(`  ${"  ".repeat(depth)}${s.kind} ${s.name}${ms !== undefined ? ` ${ms}ms` : ""}${s.input !== undefined ? ` in=${clip(text(s.input), Math.max(20, width / 2))}` : ""}${err}`);
      walk(s.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return lines;
}

export function renderBranchPoints(t: Trial, sibling?: Trial): string[] {
  if (t.pass !== false) return [];
  const ranked = rankBranchPoints(t, sibling);
  const steps = topSteps(ranked, 3);
  if (steps.length === 0) return [];
  return ["", `fork candidates: step${steps.length > 1 ? "s" : ""} ${steps.join(", ")}`, ...steps.map((step) => `  ${String(step).padStart(3)}  ${ranked.find((r) => r.step === step)!.reasons.join("; ")}`)];
}

export function renderTrial(t: Trial, width = 100, sibling?: Trial): string {
  const verdict = t.pass === true ? "PASS" : t.pass === false ? "FAIL" : "UNDECIDED";
  const ms = Date.parse(t.trace.endedAt) - Date.parse(t.trace.startedAt);
  const lines = [
    `trial ${t.id}`,
    `case ${t.trace.caseId}   target ${t.trace.targetId}   #${t.trace.trial}   ${verdict}${t.flags.length ? `   flags: ${t.flags.join(", ")}` : ""}`,
    `cost $${t.costUsd.toFixed(4)}   duration ${ms}ms   tokens ${t.trace.usage.inputTokens}+${t.trace.usage.outputTokens}${t.trace.meta?.model ? `   model ${String(t.trace.meta.model)}` : ""}`,
  ];
  if (t.trace.error) lines.push(`error: ${t.trace.error}`);
  lines.push("", "scores:");
  for (const s of t.scores) {
    lines.push(`  ${s.pass === true ? "✓" : s.pass === false ? "✗" : "?"} ${s.scorer.padEnd(20)} ${s.value.toFixed(2)}  ${s.reason ?? ""}`);
    if (s.evidence?.length) lines.push(`      evidence: ${clip(JSON.stringify(s.evidence), width * 3)}`);
  }
  lines.push("", `output: ${clip(text(t.trace.output), width * 3)}`);
  if (t.trace.messages.length) {
    lines.push("", "messages:");
    for (const m of t.trace.messages) lines.push(renderMessage(m, width));
  }
  if (t.trace.spans.length) lines.push("", "spans:", ...renderSpans(t.trace.spans, width));
  if (t.trace.artifacts?.diff) lines.push("", "diff:", ...t.trace.artifacts.diff.split("\n").slice(0, 60).map((l) => `  ${l}`));
  lines.push(...renderBranchPoints(t, sibling));
  return `${lines.join("\n")}\n`;
}

export async function explainCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, EXPLAIN_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${explainUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(explainUsage());
    return 0;
  }
  const id = args.positionals[0];
  if (!id) {
    io.stderr(explainUsage());
    return 2;
  }
  const store = new Store(await storeRoot(io));
  try {
    const trial = store.getTrial(id);
    if (!trial) {
      io.stderr(`trial ${id} not found\n`);
      return 2;
    }
    if (args.flags.json) io.stdout(`${JSON.stringify(trial, null, 2)}\n`);
    else io.stdout(renderTrial(trial, args.numbers.width ?? 100, pickSibling(trial, store.queryTrials({ runId: trial.runId, caseId: trial.trace.caseId, pass: true }))));
    return 0;
  } finally {
    store.close();
  }
}
