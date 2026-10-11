// hone traces -> OpenTelemetry GenAI spans (OTLP JSON), per docs/compat.md section 3. Attribute names live in io/otelAttrs.ts.
import { createHash } from "node:crypto";
import type { Span, Trial } from "../../core/types";
import { ATTR, EVENT_EVALUATION_RESULT, OPERATION_BY_KIND, SEMCONV_COMMIT } from "../otelAttrs";

export { SEMCONV_COMMIT };

type AnyValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean } | { arrayValue: { values: AnyValue[] } };
export interface OtlpKeyValue {
  key: string;
  value: AnyValue;
}
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpKeyValue[];
  events: { name: string; timeUnixNano: string; attributes: OtlpKeyValue[] }[];
  status: { code: number; message?: string };
}
export interface OtlpDocument {
  resourceSpans: { resource: { attributes: OtlpKeyValue[] }; scopeSpans: { scope: { name: string; version?: string }; spans: OtlpSpan[] }[] }[];
}

const SPAN_KIND_INTERNAL = 1;
const SPAN_KIND_CLIENT = 3;

export function anyValue(v: unknown): AnyValue {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean")) return { arrayValue: { values: v.map(anyValue) } };
  return { stringValue: JSON.stringify(v) };
}

const kv = (key: string, v: unknown): OtlpKeyValue[] => (v === undefined || v === null ? [] : [{ key, value: anyValue(v) }]);
/** Deterministic ids: 32 hex chars for traces, 16 for spans, derived from the trial id. */
export const traceIdOf = (trialId: string): string => createHash("sha256").update(`trace:${trialId}`).digest("hex").slice(0, 32);
export const spanIdOf = (trialId: string, spanId: string): string => createHash("sha256").update(`span:${trialId}:${spanId}`).digest("hex").slice(0, 16);
const nano = (iso: string): string => `${BigInt(Math.max(0, Date.parse(iso) || 0)) * 1_000_000n}`;

function childSpan(t: Trial, s: Span, traceId: string, rootId: string): OtlpSpan {
  const op = OPERATION_BY_KIND[s.kind];
  const attrs: OtlpKeyValue[] = kv(ATTR.operationName, s.kind === "custom" ? (typeof s.attrs?.operation === "string" ? s.attrs.operation : s.name) : op);
  if (s.kind === "tool") attrs.push(...kv(ATTR.toolName, s.name), ...kv(ATTR.toolCallId, s.attrs?.toolCallId), ...kv(ATTR.toolArguments, s.input === undefined ? undefined : typeof s.input === "string" ? s.input : JSON.stringify(s.input)), ...kv(ATTR.toolResult, s.output === undefined ? undefined : typeof s.output === "string" ? s.output : JSON.stringify(s.output)));
  else if (s.kind === "retrieval") attrs.push(...kv(ATTR.dataSourceId, s.name), ...kv(ATTR.retrievalQuery, typeof s.input === "string" ? s.input : s.input === undefined ? undefined : JSON.stringify(s.input)), ...kv(ATTR.retrievalDocuments, s.output === undefined ? undefined : JSON.stringify(s.output)));
  else if (s.kind === "llm") attrs.push(...kv(ATTR.requestModel, s.name), ...kv(ATTR.inputMessages, s.input === undefined ? undefined : JSON.stringify(s.input)), ...kv(ATTR.outputMessages, s.output === undefined ? undefined : JSON.stringify(s.output)), ...kv(ATTR.inputTokens, s.attrs?.inputTokens), ...kv(ATTR.outputTokens, s.attrs?.outputTokens));
  else if (s.kind === "agent") attrs.push(...kv(ATTR.agentName, s.name));
  for (const [k, v] of Object.entries(s.attrs ?? {})) if (!["error", "toolCallId", "inputTokens", "outputTokens", "operation"].includes(k)) attrs.push(...kv(`hone.${k}`, v));
  const error = s.attrs?.error;
  if (error) attrs.push(...kv(ATTR.errorType, typeof error === "string" ? error : "error"));
  const name = s.kind === "custom" ? s.name : `${op} ${s.name}`;
  return {
    traceId,
    spanId: spanIdOf(t.id, s.id),
    parentSpanId: s.parentId ? spanIdOf(t.id, s.parentId) : rootId,
    name,
    kind: s.kind === "llm" || s.kind === "retrieval" ? SPAN_KIND_CLIENT : SPAN_KIND_INTERNAL,
    startTimeUnixNano: nano(s.startedAt),
    endTimeUnixNano: nano(s.endedAt ?? s.startedAt),
    attributes: attrs,
    events: [],
    status: error ? { code: 2, message: typeof error === "string" ? error : "error" } : { code: 0 },
  };
}

/** One root invoke_agent span per trial (messages, ids, one evaluation event per score) plus one child span per hone span. */
export function trialToSpans(t: Trial): OtlpSpan[] {
  const traceId = traceIdOf(t.id);
  const rootId = spanIdOf(t.id, "root");
  const { trace } = t;
  const firstAssistant = trace.messages.findIndex((m) => m.role === "assistant");
  const input = firstAssistant === -1 ? trace.messages : trace.messages.slice(0, firstAssistant);
  const output = firstAssistant === -1 ? [] : trace.messages.slice(firstAssistant);
  const attrs: OtlpKeyValue[] = [
    ...kv(ATTR.operationName, "invoke_agent"),
    ...kv(ATTR.agentName, trace.targetId),
    ...kv(ATTR.conversationId, trace.caseId),
    ...kv(ATTR.requestModel, trace.meta?.model),
    ...kv(ATTR.inputTokens, trace.usage.inputTokens),
    ...kv(ATTR.outputTokens, trace.usage.outputTokens),
    ...kv(ATTR.inputMessages, JSON.stringify(input)),
    ...kv(ATTR.outputMessages, JSON.stringify(output)),
    ...kv("hone.trial.id", t.id),
    ...kv("hone.run.id", t.runId),
    ...kv("hone.trial", trace.trial),
    ...kv("hone.pass", t.pass === null ? "undecided" : String(t.pass)),
    ...kv("hone.flags", t.flags),
    ...kv("hone.cost_usd", t.costUsd),
    ...(trace.error ? kv(ATTR.errorType, trace.error) : []),
  ];
  const events = t.scores.map((s) => ({
    name: EVENT_EVALUATION_RESULT,
    timeUnixNano: nano(trace.endedAt),
    attributes: [...kv(ATTR.evaluationName, s.scorer), ...kv(ATTR.evaluationScoreValue, s.value), ...kv(ATTR.evaluationScoreLabel, s.pass === true ? "pass" : s.pass === false ? "fail" : undefined), ...kv(ATTR.evaluationExplanation, s.reason)],
  }));
  const root: OtlpSpan = { traceId, spanId: rootId, name: `invoke_agent ${trace.targetId}`, kind: SPAN_KIND_INTERNAL, startTimeUnixNano: nano(trace.startedAt), endTimeUnixNano: nano(trace.endedAt), attributes: attrs, events, status: trace.error ? { code: 2, message: trace.error } : { code: 0 } };
  return [root, ...trace.spans.map((s) => childSpan(t, s, traceId, rootId))];
}

export function tracesToOtel(trials: Trial[], opts: { serviceName?: string; version?: string } = {}): OtlpDocument {
  return {
    resourceSpans: [
      {
        resource: { attributes: [...kv("service.name", opts.serviceName ?? "hone"), ...kv("hone.semconv.commit", SEMCONV_COMMIT)] },
        scopeSpans: [{ scope: { name: "hone", ...(opts.version ? { version: opts.version } : {}) }, spans: trials.flatMap(trialToSpans) }],
      },
    ],
  };
}
