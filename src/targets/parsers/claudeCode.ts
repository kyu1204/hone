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

interface MessageUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

export interface TokenBreakdown {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
}

const breakdown = (u: MessageUsage): TokenBreakdown => ({ input: u.input_tokens ?? 0, cacheCreation: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 });
const names = (xs: unknown): string[] | undefined => (Array.isArray(xs) ? xs.map((x) => (typeof x === "string" ? x : String((x as { name?: unknown } | null)?.name ?? ""))).filter(Boolean) : undefined);

/**
 * Convert stream-json or session records (`type` user/assistant/system/result) to messages, spans and usage.
 * `humanTurns` also keeps user text as `user` messages (session import); the stream parser gives the prompt itself.
 *
 * Shapes this follows (Claude Code 2.1.x): one API message arrives as several `assistant` records, one per content
 * block, sharing `message.id` and repeating its usage; hooks, thinking estimates and task notices arrive as `system`
 * records with a `subtype`; nearly all prompt tokens are cache reads and writes, reported beside `input_tokens`.
 */
export function recordsToParsed(records: Record<string, unknown>[], opts: { humanTurns?: boolean } = {}): ParsedStream {
  const messages: ChatMessage[] = [];
  const spans: Span[] = [];
  const meta: Record<string, unknown> = {};
  const usage: Partial<Usage> = {};
  let output: unknown = null;
  const openTools = new Map<string, Span>();
  const turns = new Map<string, ChatMessage>();
  const usageByMessage = new Map<string, MessageUsage>();
  const hooks = new Set<string>();
  let resultTokens: TokenBreakdown | undefined;
  let sawSession = false;
  let seq = 0;
  let anonymous = 0;

  for (const rec of records) {
    const now = typeof rec.timestamp === "string" && !Number.isNaN(Date.parse(rec.timestamp)) ? rec.timestamp : new Date().toISOString();
    if (rec.type === "system") {
      const subtype = typeof rec.subtype === "string" ? rec.subtype : undefined;
      if (subtype === "hook_started" && typeof rec.hook_name === "string") hooks.add(rec.hook_name);
      // only the init record describes the session; hook output, thinking estimates and task notices are not turns
      if (subtype !== undefined && subtype !== "init") continue;
      if (typeof rec.model === "string") meta.model = rec.model;
      if (typeof rec.session_id === "string") meta.sessionId = rec.session_id;
      if (typeof rec.claude_code_version === "string") meta.claudeCodeVersion = rec.claude_code_version;
      if (typeof rec.permissionMode === "string") meta.permissionMode = rec.permissionMode;
      if (Array.isArray(rec.tools)) meta.toolCount = rec.tools.length;
      const plugins = names(rec.plugins);
      if (plugins) meta.plugins = plugins;
      const mcpServers = names(rec.mcp_servers);
      if (mcpServers) meta.mcpServers = mcpServers;
      if (!sawSession) messages.push({ role: "system", content: `claude-code session ${String(rec.session_id ?? "")} model ${String(rec.model ?? "")}`.trim() });
      sawSession = true;
      continue;
    }
    if (rec.type === "rate_limit_event") {
      const info = rec.rate_limit_info as { status?: unknown; rateLimitType?: unknown; unifiedWindows?: { five_hour?: { utilization?: unknown }; seven_day?: { utilization?: unknown } } } | undefined;
      if (info) meta.rateLimit = { status: info.status, type: info.rateLimitType, fiveHour: info.unifiedWindows?.five_hour?.utilization, sevenDay: info.unifiedWindows?.seven_day?.utilization };
      continue;
    }
    if (rec.type === "assistant" || rec.type === "user") {
      const msg = rec.message as { id?: unknown; content?: unknown; usage?: MessageUsage; model?: unknown } | undefined;
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
        const id = typeof msg?.id === "string" ? msg.id : undefined;
        const turn = id === undefined ? undefined : turns.get(id);
        if (turn) {
          // a later block of a message already seen: same turn
          if (text) turn.content = `${turn.content as string}${text}`;
          if (toolCalls.length) turn.tool_calls = [...(turn.tool_calls ?? []), ...toolCalls];
        } else {
          const m: ChatMessage = { role: "assistant", content: text };
          if (toolCalls.length) m.tool_calls = toolCalls;
          messages.push(m);
          if (id !== undefined) turns.set(id, m);
        }
        // the usage repeats on every record of a message, so keep one (the latest) per message id
        if (msg?.usage) usageByMessage.set(id ?? `anonymous-${anonymous++}`, msg.usage);
        if (typeof msg?.model === "string" && meta.model === undefined) meta.model = msg.model;
      } else {
        if (opts.humanTurns && !rec.isMeta && !rec.isSidechain) {
          const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
          if (text) messages.push({ role: "user", content: text });
        }
        for (const b of blocks) {
          if (b.type !== "tool_result") continue;
          const content = blockText(b.content);
          const span = b.tool_use_id ? openTools.get(b.tool_use_id) : undefined;
          messages.push({ role: "tool", tool_call_id: b.tool_use_id ?? "", ...(span ? { name: span.name } : {}), content });
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
      if (typeof rec.usage === "object" && rec.usage !== null) resultTokens = breakdown(rec.usage as MessageUsage);
      if (typeof rec.total_cost_usd === "number") usage.costUsd = rec.total_cost_usd;
      if (rec.is_error) meta.isError = true;
      if (typeof rec.num_turns === "number") meta.numTurns = rec.num_turns;
    }
  }
  // the result record carries the run's totals; without one (a session file), add up one usage per message
  let tokens = resultTokens;
  if (!tokens && usageByMessage.size) {
    tokens = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
    for (const u of usageByMessage.values()) {
      const b = breakdown(u);
      tokens.input += b.input;
      tokens.cacheCreation += b.cacheCreation;
      tokens.cacheRead += b.cacheRead;
      tokens.output += b.output;
    }
  }
  if (tokens) {
    // prompt tokens the model processed: fresh input plus cache writes and cache reads
    usage.inputTokens = tokens.input + tokens.cacheCreation + tokens.cacheRead;
    usage.outputTokens = tokens.output;
    meta.tokens = tokens;
  }
  if (hooks.size) meta.hooks = [...hooks];
  // a message whose only block was thinking has nothing to show
  const kept = messages.filter((m) => !(m.role === "assistant" && m.content === "" && !m.tool_calls?.length));
  if (output === null) output = kept.filter((m) => m.role === "assistant").at(-1)?.content ?? null;
  return { output, messages: kept, spans, usage, meta };
}
