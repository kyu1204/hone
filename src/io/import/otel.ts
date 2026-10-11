// OpenTelemetry GenAI spans (OTLP JSON or a bare spans[]) -> hone traces; the inverse of io/export/otel.ts.
import type { Case, ChatMessage, Score, Span, SpanKind } from "../../core/types";
import { ATTR, EVENT_EVALUATION_RESULT, KIND_BY_OPERATION } from "../otelAttrs";
import { type Imported, makeTrial, nowIso, toChatMessage } from "./common";

type Attrs = Record<string, unknown>;
interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: unknown;
  events?: { name?: string; timeUnixNano?: string | number; attributes?: unknown }[];
  status?: { code?: number; message?: string };
}

function anyValue(v: unknown): unknown {
  if (typeof v !== "object" || v === null) return v;
  const o = v as Record<string, unknown>;
  if ("stringValue" in o) return o.stringValue;
  if ("intValue" in o) return Number(o.intValue);
  if ("doubleValue" in o) return o.doubleValue;
  if ("boolValue" in o) return o.boolValue;
  if ("arrayValue" in o) return ((o.arrayValue as { values?: unknown[] }).values ?? []).map(anyValue);
  if ("kvlistValue" in o) return attrsOf((o.kvlistValue as { values?: unknown }).values);
  return v;
}

/** OTLP `[{key, value}]` or a plain object -> plain object. */
export function attrsOf(raw: unknown): Attrs {
  if (Array.isArray(raw)) return Object.fromEntries(raw.map((kv) => [String((kv as { key: unknown }).key), anyValue((kv as { value: unknown }).value)]));
  if (typeof raw === "object" && raw !== null) return raw as Attrs;
  return {};
}

const nanoToIso = (n: string | number | undefined): string | undefined => (n === undefined ? undefined : new Date(Number(BigInt(n) / 1_000_000n)).toISOString());
const parseMaybeJson = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

export function spansOf(json: unknown): OtlpSpan[] {
  const o = json as { resourceSpans?: { scopeSpans?: { spans?: OtlpSpan[] }[] }[]; spans?: OtlpSpan[] };
  if (Array.isArray(o?.spans)) return o.spans;
  if (Array.isArray(o?.resourceSpans)) return o.resourceSpans.flatMap((r) => (r.scopeSpans ?? []).flatMap((s) => s.spans ?? []));
  if (Array.isArray(json)) return json as OtlpSpan[];
  throw new Error("not OTel JSON: expected resourceSpans[] or spans[]");
}

export function toHoneSpan(s: OtlpSpan, a: Attrs): Span {
  const op = typeof a[ATTR.operationName] === "string" ? (a[ATTR.operationName] as string) : undefined;
  const kind: SpanKind = (op ? KIND_BY_OPERATION[op] : undefined) ?? "custom";
  const name = kind === "tool" ? String(a[ATTR.toolName] ?? s.name ?? "tool") : kind === "retrieval" ? String(a[ATTR.dataSourceId] ?? s.name ?? "retrieval") : kind === "llm" ? String(a[ATTR.requestModel] ?? s.name ?? "llm") : kind === "agent" ? String(a[ATTR.agentName] ?? s.name ?? "agent") : String(s.name ?? op ?? "span");
  const span: Span = { id: String(s.spanId ?? crypto.randomUUID()), kind, name, startedAt: nanoToIso(s.startTimeUnixNano) ?? nowIso() };
  if (s.parentSpanId) span.parentId = String(s.parentSpanId);
  const ended = nanoToIso(s.endTimeUnixNano);
  if (ended) span.endedAt = ended;
  if (kind === "tool") {
    if (a[ATTR.toolArguments] !== undefined) span.input = parseMaybeJson(a[ATTR.toolArguments]);
    if (a[ATTR.toolResult] !== undefined) span.output = parseMaybeJson(a[ATTR.toolResult]);
  } else if (kind === "retrieval") {
    if (a[ATTR.retrievalQuery] !== undefined) span.input = a[ATTR.retrievalQuery];
    if (a[ATTR.retrievalDocuments] !== undefined) span.output = parseMaybeJson(a[ATTR.retrievalDocuments]);
  } else if (kind === "llm") {
    if (a[ATTR.inputMessages] !== undefined) span.input = parseMaybeJson(a[ATTR.inputMessages]);
    if (a[ATTR.outputMessages] !== undefined) span.output = parseMaybeJson(a[ATTR.outputMessages]);
  }
  const attrs: Attrs = Object.fromEntries(Object.entries(a).filter(([k]) => ![ATTR.toolArguments, ATTR.toolResult, ATTR.retrievalDocuments, ATTR.inputMessages, ATTR.outputMessages].includes(k as never)));
  if (s.status?.code === 2) attrs.error = s.status.message || true;
  if (typeof a[ATTR.errorType] === "string") attrs.error = a[ATTR.errorType];
  if (Object.keys(attrs).length) span.attrs = attrs;
  return span;
}

function scoresOf(s: OtlpSpan): Score[] {
  return (s.events ?? [])
    .filter((e) => e.name === EVENT_EVALUATION_RESULT)
    .map((e) => {
      const a = attrsOf(e.attributes);
      const label = a[ATTR.evaluationScoreLabel];
      const value = typeof a[ATTR.evaluationScoreValue] === "number" ? (a[ATTR.evaluationScoreValue] as number) : label === "pass" ? 1 : 0;
      return { scorer: String(a[ATTR.evaluationName] ?? "evaluation"), value: Math.max(0, Math.min(1, value)), pass: label === "pass" ? true : label === "fail" ? false : null, ...(typeof a[ATTR.evaluationExplanation] === "string" ? { reason: a[ATTR.evaluationExplanation] as string } : {}) };
    });
}

const toMessages = (v: unknown): ChatMessage[] => {
  const parsed = parseMaybeJson(v);
  return Array.isArray(parsed) ? parsed.map((m) => toChatMessage(m as Record<string, unknown>)) : [];
};

/** One hone trace per OTel trace id; the root span (no parent, or the invoke_agent span) carries messages, ids and evaluations. */
export function importOtel(json: unknown, opts: { runId?: string; target?: string } = {}): Imported {
  const spans = spansOf(json);
  const byTrace = new Map<string, OtlpSpan[]>();
  for (const s of spans) (byTrace.get(String(s.traceId ?? "trace")) ?? byTrace.set(String(s.traceId ?? "trace"), []).get(String(s.traceId ?? "trace"))!).push(s);
  const cases = new Map<string, Case>();
  const perCase = new Map<string, number>();
  const trials = [...byTrace.entries()].map(([traceId, group]) => {
    const withAttrs = group.map((s) => ({ s, a: attrsOf(s.attributes) }));
    const root = withAttrs.find(({ a }) => a[ATTR.operationName] === "invoke_agent") ?? withAttrs.find(({ s }) => !s.parentSpanId) ?? withAttrs[0]!;
    const a = root.a;
    const messages = [...toMessages(a[ATTR.inputMessages]), ...toMessages(a[ATTR.outputMessages])];
    const caseId = String(a[ATTR.conversationId] ?? traceId);
    const targetId = opts.target ?? String(a[ATTR.agentName] ?? a[ATTR.requestModel] ?? "otel");
    const honeSpans = withAttrs.map(({ s, a: sa }) => toHoneSpan(s, sa));
    const starts = honeSpans.map((s) => s.startedAt).sort();
    const ends = honeSpans.map((s) => s.endedAt ?? s.startedAt).sort();
    let inputTokens = 0;
    let outputTokens = 0;
    for (const { a: sa } of withAttrs) {
      if (typeof sa[ATTR.inputTokens] === "number") inputTokens += sa[ATTR.inputTokens] as number;
      if (typeof sa[ATTR.outputTokens] === "number") outputTokens += sa[ATTR.outputTokens] as number;
    }
    const trial = perCase.get(caseId) ?? 0;
    perCase.set(caseId, trial + 1);
    if (!cases.has(caseId)) cases.set(caseId, { id: caseId, input: messages.find((m) => m.role === "user")?.content ?? caseId, tags: ["otel"] });
    const errorSpan = honeSpans.find((s) => s.kind === "agent" && s.attrs?.error);
    return makeTrial(opts.runId ?? "imported", {
      caseId,
      targetId,
      trial,
      startedAt: starts[0] ?? nowIso(),
      endedAt: ends.at(-1) ?? starts[0] ?? nowIso(),
      messages,
      spans: honeSpans,
      output: messages.filter((m) => m.role === "assistant").at(-1)?.content ?? null,
      usage: { inputTokens, outputTokens, costUsd: 0 },
      ...(errorSpan ? { error: String(errorSpan.attrs!.error) } : {}),
      meta: { otel: { traceId, rootSpanId: root.s.spanId }, model: a[ATTR.requestModel] ?? withAttrs.find(({ a: sa }) => sa[ATTR.requestModel])?.a[ATTR.requestModel] },
    }, scoresOf(root.s));
  });
  return { cases: [...cases.values()], trials };
}
