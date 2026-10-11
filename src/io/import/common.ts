// Shared helpers for importers: message normalisation, verdicts, trial assembly.
import { Store } from "../../core/store";
import type { ChatMessage, ContentPart, Score, Trace, Trial } from "../../core/types";

export interface Imported {
  cases: import("../../core/types").Case[];
  trials: Trial[];
}

export const verdictOf = (scores: Score[]): boolean | null => (scores.some((s) => s.pass === false) ? false : scores.some((s) => s.pass === true) ? true : null);

/** OpenAI-shaped message from a loosely typed object: tool_calls with object arguments, content arrays, Inspect's `function` field. */
export function toChatMessage(m: Record<string, unknown>): ChatMessage {
  const role = String(m.role ?? "user") as ChatMessage["role"];
  let content: string | ContentPart[];
  if (typeof m.content === "string") content = m.content;
  else if (Array.isArray(m.content)) {
    const parts = m.content.map((p) => (typeof p === "string" ? { type: "text" as const, text: p } : (p as Record<string, unknown>)));
    content = parts.every((p) => (p as { type?: unknown }).type === "text") ? parts.map((p) => String((p as { text?: unknown }).text ?? "")).join("\n") : parts.map((p) => ((p as { type?: unknown }).type === "text" ? { type: "text" as const, text: String((p as { text?: unknown }).text ?? "") } : { type: "image_url" as const, image_url: { url: String((p as { image?: unknown; image_url?: { url?: unknown } }).image ?? (p as { image_url?: { url?: unknown } }).image_url?.url ?? "") } }));
  } else content = m.content === undefined || m.content === null ? "" : JSON.stringify(m.content);
  const out: ChatMessage = { role: role === "tool" || role === "assistant" || role === "system" || role === "user" ? role : "user", content };
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
    out.tool_calls = m.tool_calls.map((c, i) => {
      const call = c as Record<string, unknown>;
      const fn = (typeof call.function === "object" && call.function !== null ? call.function : { name: call.function, arguments: call.arguments }) as { name?: unknown; arguments?: unknown };
      return { id: String(call.id ?? `call_${i}`), type: "function" as const, function: { name: String(fn.name ?? "tool"), arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}) } };
    });
  }
  if (typeof m.tool_call_id === "string") out.tool_call_id = m.tool_call_id;
  const name = m.name ?? (role === "tool" ? m.function : undefined);
  if (typeof name === "string") out.name = name;
  return out;
}

export function makeTrial(runId: string, trace: Omit<Trace, "id">, scores: Score[], extra: Partial<Pick<Trial, "flags" | "costUsd">> = {}): Trial {
  const id = Store.trialId(runId, trace.caseId, trace.targetId, trace.trial);
  return { id, runId, trace: { ...trace, id }, scores, flags: extra.flags ?? [], pass: verdictOf(scores), costUsd: extra.costUsd ?? trace.usage.costUsd };
}

export const nowIso = (): string => new Date().toISOString();
