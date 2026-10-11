// Parser for `opencode run --format json` (NDJSON of parts). Best effort: text parts become
// assistant messages, tool parts become tool_calls + tool results.
import type { ChatMessage, Span, Usage } from "../../core/types";
import { type ParsedStream, parseNdjson } from "./claudeCode";

export function parseOpencodeStream(text: string): ParsedStream {
  const messages: ChatMessage[] = [];
  const spans: Span[] = [];
  const usage: Partial<Usage> = {};
  let output: unknown = null;
  let seq = 0;
  for (const rec of parseNdjson(text)) {
    const part = (rec.part as Record<string, unknown> | undefined) ?? rec;
    const type = String(part.type ?? rec.type ?? "");
    const now = new Date().toISOString();
    if (type === "text") {
      output = part.text ?? output;
      messages.push({ role: "assistant", content: String(part.text ?? "") });
    } else if (type === "tool" || type === "tool-invocation") {
      const id = String(part.id ?? part.callID ?? `call_${++seq}`);
      const name = String(part.tool ?? part.name ?? "tool");
      const state = (part.state as Record<string, unknown> | undefined) ?? {};
      messages.push({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(state.input ?? part.input ?? {}) } }] });
      messages.push({ role: "tool", tool_call_id: id, content: String(state.output ?? part.output ?? "") });
      spans.push({ id: `t${++seq}`, kind: "tool", name, startedAt: now, endedAt: now, input: state.input ?? part.input, output: state.output ?? part.output });
    } else if (type === "step-finish" || type === "usage") {
      const t = (part.tokens as { input?: number; output?: number } | undefined) ?? (rec.tokens as { input?: number; output?: number } | undefined);
      if (t) {
        usage.inputTokens = (usage.inputTokens ?? 0) + (t.input ?? 0);
        usage.outputTokens = (usage.outputTokens ?? 0) + (t.output ?? 0);
      }
      if (typeof part.cost === "number") usage.costUsd = (usage.costUsd ?? 0) + part.cost;
    }
  }
  return { output, messages, spans, usage, meta: {} };
}
