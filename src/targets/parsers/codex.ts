// Parser for `codex exec --json` (NDJSON of thread/turn/item events).
import type { ChatMessage, Span, Usage } from "../../core/types";
import { type ParsedStream, parseNdjson } from "./claudeCode";

export function parseCodexStream(text: string): ParsedStream {
  const messages: ChatMessage[] = [];
  const spans: Span[] = [];
  const meta: Record<string, unknown> = {};
  const usage: Partial<Usage> = {};
  let output: unknown = null;
  let seq = 0;
  for (const rec of parseNdjson(text)) {
    if (rec.type === "thread.started" && typeof rec.thread_id === "string") meta.threadId = rec.thread_id;
    if (rec.type === "item.completed") {
      const item = rec.item as Record<string, unknown> | undefined;
      if (!item) continue;
      const now = new Date().toISOString();
      if (item.type === "agent_message") {
        output = item.text ?? null;
        messages.push({ role: "assistant", content: String(item.text ?? "") });
      } else if (item.type === "command_execution") {
        const id = String(item.id ?? `call_${++seq}`);
        messages.push({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: "shell", arguments: JSON.stringify({ command: item.command }) } }] });
        messages.push({ role: "tool", tool_call_id: id, content: String(item.aggregated_output ?? "") });
        spans.push({ id: `t${++seq}`, kind: "tool", name: "shell", startedAt: now, endedAt: now, input: { command: item.command }, output: item.aggregated_output, attrs: { exitCode: item.exit_code } });
      } else if (item.type === "file_change" || item.type === "mcp_tool_call") {
        const id = String(item.id ?? `call_${++seq}`);
        const name = String(item.type === "mcp_tool_call" ? (item.tool ?? "mcp") : "apply_patch");
        messages.push({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(item) } }] });
        messages.push({ role: "tool", tool_call_id: id, content: String(item.status ?? "completed") });
        spans.push({ id: `t${++seq}`, kind: "tool", name, startedAt: now, endedAt: now, input: item });
      }
    }
    if (rec.type === "turn.completed") {
      const u = rec.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      usage.inputTokens = (usage.inputTokens ?? 0) + (u?.input_tokens ?? 0);
      usage.outputTokens = (usage.outputTokens ?? 0) + (u?.output_tokens ?? 0);
      usage.costUsd = usage.costUsd ?? 0;
    }
  }
  return { output, messages, spans, usage, meta };
}
