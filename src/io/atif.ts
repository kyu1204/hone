// Harbor ATIF (Agent Trajectory Interchange Format) v1.x <-> hone messages.
// Shape documented in docs/compat.md section 1 (read 2026-10-12).
import type { ChatMessage, Span, ToolCall } from "../core/types";

export interface AtifToolCall {
  tool_call_id: string;
  function_name: string;
  arguments: unknown;
  extra?: Record<string, unknown>;
}
export interface AtifObservationResult {
  source_call_id: string;
  content: unknown;
  extra?: Record<string, unknown>;
}
export interface AtifStep {
  step_id: number;
  timestamp: string;
  source: "user" | "agent" | "system";
  model_name?: string;
  message: string;
  tool_calls?: AtifToolCall[];
  observation?: { results: AtifObservationResult[] };
  metrics?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}
export interface AtifTrajectory {
  schema_version: string;
  session_id: string;
  agent: { name: string; version: string; model_name?: string; extra?: Record<string, unknown> };
  steps: AtifStep[];
  extra?: Record<string, unknown>;
}

export const ATIF_VERSION = "ATIF-v1.7";

function contentString(c: unknown): string {
  return typeof c === "string" ? c : JSON.stringify(c);
}

export function atifToMessages(t: AtifTrajectory): { messages: ChatMessage[]; spans: Span[]; meta: Record<string, unknown> } {
  if (typeof t?.schema_version !== "string" || !/^ATIF-v1\.\d+$/.test(t.schema_version) || !Array.isArray(t.steps)) {
    throw new Error(`not an ATIF v1.x trajectory (schema_version ${String(t?.schema_version)})`);
  }
  const messages: ChatMessage[] = [];
  const spans: Span[] = [];
  const meta: Record<string, unknown> = { agent: t.agent?.name, model: t.agent?.model_name, sessionId: t.session_id, atifVersion: t.schema_version };
  for (const step of t.steps) {
    if (step.source === "user") {
      messages.push({ role: "user", content: step.message ?? "" });
    } else if (step.source === "agent") {
      const m: ChatMessage = { role: "assistant", content: step.message ?? "" };
      const calls: ToolCall[] = (step.tool_calls ?? []).map((c) => ({ id: c.tool_call_id, type: "function", function: { name: c.function_name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? {}) } }));
      if (calls.length) m.tool_calls = calls;
      messages.push(m);
      const results = step.observation?.results ?? [];
      for (const c of step.tool_calls ?? []) {
        const r = results.find((x) => x.source_call_id === c.tool_call_id);
        const span: Span = { id: `atif-${step.step_id}-${c.tool_call_id}`, kind: "tool", name: c.function_name, startedAt: step.timestamp, endedAt: step.timestamp, input: c.arguments };
        if (r) span.output = r.content;
        spans.push(span);
      }
      for (const r of results) messages.push({ role: "tool", tool_call_id: r.source_call_id, content: contentString(r.content) });
    } else {
      messages.push({ role: "system", content: step.message ?? "" });
    }
  }
  return { messages, spans, meta };
}

export function messagesToAtif(messages: ChatMessage[], agent: AtifTrajectory["agent"], sessionId = crypto.randomUUID()): AtifTrajectory {
  const steps: AtifStep[] = [];
  const now = new Date().toISOString();
  let id = 0;
  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("\n");
    if (m.role === "tool") {
      const last = steps.at(-1);
      if (last && last.source === "agent") {
        (last.observation ??= { results: [] }).results.push({ source_call_id: m.tool_call_id ?? "", content: text });
        continue;
      }
      steps.push({ step_id: ++id, timestamp: now, source: "system", message: text });
      continue;
    }
    const step: AtifStep = { step_id: ++id, timestamp: now, source: m.role === "assistant" ? "agent" : m.role === "user" ? "user" : "system", message: text };
    if (m.tool_calls?.length) {
      step.tool_calls = m.tool_calls.map((c) => {
        let args: unknown = c.function.arguments;
        try {
          args = JSON.parse(c.function.arguments);
        } catch {
          // keep the raw string
        }
        return { tool_call_id: c.id, function_name: c.function.name, arguments: args };
      });
    }
    steps.push(step);
  }
  return { schema_version: ATIF_VERSION, session_id: sessionId, agent, steps };
}
