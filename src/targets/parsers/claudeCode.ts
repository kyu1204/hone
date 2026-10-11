// Parser for `claude -p --output-format stream-json --verbose` (NDJSON).
import type { ChatMessage, Span, ToolCall, Usage } from "../../core/types";

export interface ParsedStream {
  output: unknown;
  messages: ChatMessage[];
  spans: Span[];
  usage: Partial<Usage>;
  meta: Record<string, unknown>;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : typeof c === "object" && c && "text" in c ? String((c as { text: unknown }).text) : JSON.stringify(c))).join("\n");
  return content === undefined ? "" : JSON.stringify(content);
}

export function parseNdjson(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      out.push(JSON.parse(t) as Record<string, unknown>);
    } catch {
      // partial or non-JSON line: ignore
    }
  }
  return out;
}

export function parseClaudeStream(text: string): ParsedStream {
  return recordsToParsed(parseNdjson(text));
}

/**
 * Convert stream-json or session records (`type` user/assistant/system/result) to messages, spans and usage.
 * `humanTurns` also keeps user text as `user` messages (session import); the stream parser gives the prompt itself.
 */
export function recordsToParsed(records: Record<string, unknown>[], opts: { humanTurns?: boolean } = {}): ParsedStream {
  const messages: ChatMessage[] = [];
  const spans: Span[] = [];
  const meta: Record<string, unknown> = {};
  const usage: Partial<Usage> = {};
  let output: unknown = null;
  const openTools = new Map<string, Span>();
  let seq = 0;

  for (const rec of records) {
    const now = typeof rec.timestamp === "string" && !Number.isNaN(Date.parse(rec.timestamp)) ? rec.timestamp : new Date().toISOString();
    if (rec.type === "system") {
      if (typeof rec.model === "string") meta.model = rec.model;
      if (typeof rec.session_id === "string") meta.sessionId = rec.session_id;
      messages.push({ role: "system", content: `claude-code session ${String(rec.session_id ?? "")} model ${String(rec.model ?? "")}`.trim() });
      continue;
    }
    if (rec.type === "assistant" || rec.type === "user") {
      const msg = rec.message as { content?: unknown } | undefined;
      const blocks: ContentBlock[] = Array.isArray(msg?.content) ? (msg!.content as ContentBlock[]) : typeof msg?.content === "string" ? [{ type: "text", text: msg.content }] : [];
      if (rec.type === "assistant") {
        const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
        const toolCalls: ToolCall[] = blocks
          .filter((b) => b.type === "tool_use")
          .map((b) => {
            const span: Span = { id: `t${++seq}`, kind: "tool", name: b.name ?? "tool", startedAt: now, input: b.input };
            spans.push(span);
            if (b.id) openTools.set(b.id, span);
            return { id: b.id ?? `call_${seq}`, type: "function", function: { name: b.name ?? "tool", arguments: JSON.stringify(b.input ?? {}) } };
          });
        const m: ChatMessage = { role: "assistant", content: text };
        if (toolCalls.length) m.tool_calls = toolCalls;
        messages.push(m);
        // per-message usage (sessions); a trailing `result` record overrides with the run total
        const u = (msg as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined)?.usage;
        if (typeof u?.input_tokens === "number") usage.inputTokens = (usage.inputTokens ?? 0) + u.input_tokens;
        if (typeof u?.output_tokens === "number") usage.outputTokens = (usage.outputTokens ?? 0) + u.output_tokens;
        const model = (msg as { model?: unknown } | undefined)?.model;
        if (typeof model === "string" && meta.model === undefined) meta.model = model;
      } else {
        if (opts.humanTurns && !rec.isMeta && !rec.isSidechain) {
          const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
          if (text) messages.push({ role: "user", content: text });
        }
        for (const b of blocks) {
          if (b.type !== "tool_result") continue;
          const content = blockText(b.content);
          messages.push({ role: "tool", tool_call_id: b.tool_use_id ?? "", content });
          const span = b.tool_use_id ? openTools.get(b.tool_use_id) : undefined;
          if (span) {
            span.endedAt = now;
            span.output = content;
            if (b.is_error) (span.attrs ??= {}).error = true;
          }
        }
      }
      continue;
    }
    if (rec.type === "result") {
      output = rec.result ?? null;
      const u = rec.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      if (u?.input_tokens !== undefined) usage.inputTokens = u.input_tokens;
      if (u?.output_tokens !== undefined) usage.outputTokens = u.output_tokens;
      if (typeof rec.total_cost_usd === "number") usage.costUsd = rec.total_cost_usd;
      if (rec.is_error) meta.isError = true;
      if (typeof rec.num_turns === "number") meta.numTurns = rec.num_turns;
    }
  }
  if (output === null) output = messages.filter((m) => m.role === "assistant").at(-1)?.content ?? null;
  return { output, messages, spans, usage, meta };
}
