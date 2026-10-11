import { describe, expect, test } from "bun:test";
import valid from "../../../test/fixtures/trace.valid.json";
import type { Trace, Trial } from "../../core/types";
import { importOtel } from "../import/otel";
import { ATTR } from "../otelAttrs";
import { SEMCONV_COMMIT, traceIdOf, tracesToOtel, trialToSpans } from "./otel";

const base = valid as Trace;
const trial: Trial = { id: "r-c-t-0", runId: "r", trace: { ...base, meta: { model: "gpt-5" } }, scores: [{ scorer: "exact", value: 1, pass: true, reason: "equal" }, { scorer: "rag.citations", value: 0.5, pass: false }], flags: ["cached"], pass: false, costUsd: 0.01 };
const attr = (s: { attributes: { key: string; value: Record<string, unknown> }[] }, key: string): unknown => {
  const v = s.attributes.find((a) => a.key === key)?.value;
  return v === undefined ? undefined : Object.values(v)[0];
};

describe("otel export", () => {
  test("root invoke_agent span with messages, ids, evaluation events; child spans mapped by kind; deterministic ids", () => {
    const spans = trialToSpans(trial);
    expect(spans).toHaveLength(1 + base.spans.length);
    const root = spans[0]!;
    expect(root.name).toBe(`invoke_agent ${base.targetId}`);
    expect(attr(root, ATTR.operationName)).toBe("invoke_agent");
    expect(attr(root, ATTR.agentName)).toBe(base.targetId);
    expect(attr(root, ATTR.conversationId)).toBe(base.caseId);
    expect(attr(root, ATTR.requestModel)).toBe("gpt-5");
    expect(JSON.parse(attr(root, ATTR.inputMessages) as string)).toHaveLength(2);
    expect(root.events.map((e) => e.name)).toEqual(["gen_ai.evaluation.result", "gen_ai.evaluation.result"]);
    expect(attr(root.events[0]!, ATTR.evaluationName)).toBe("exact");
    expect(attr(root.events[1]!, ATTR.evaluationScoreLabel)).toBe("fail");
    const retrieval = spans.find((s) => attr(s, ATTR.operationName) === "retrieval")!;
    expect(retrieval.parentSpanId).toBe(root.spanId);
    expect(retrieval.kind).toBe(3);
    expect(attr(retrieval, ATTR.dataSourceId)).toBe("search");
    expect(JSON.parse(attr(retrieval, ATTR.retrievalDocuments) as string)[0].id).toBe("c1");
    expect(root.traceId).toBe(traceIdOf(trial.id));
    expect(root.traceId).toHaveLength(32);
    expect(root.spanId).toHaveLength(16);
    expect(trialToSpans(trial)).toEqual(spans);
    expect(BigInt(root.endTimeUnixNano) > BigInt(root.startTimeUnixNano)).toBe(true);
  });

  test("document shape, resource attributes, and a round trip through the importer", () => {
    const doc = tracesToOtel([trial], { version: "0.1.0" });
    expect(doc.resourceSpans[0]!.resource.attributes.find((a) => a.key === "hone.semconv.commit")!.value).toEqual({ stringValue: SEMCONV_COMMIT });
    expect(doc.resourceSpans[0]!.scopeSpans[0]!.scope).toEqual({ name: "hone", version: "0.1.0" });
    const back = importOtel(doc, { runId: "x" });
    expect(back.cases[0]!.id).toBe(base.caseId);
    const t = back.trials[0]!;
    expect(t.trace.targetId).toBe(base.targetId);
    expect(t.trace.messages).toEqual(base.messages);
    expect(t.trace.spans.map((s) => s.kind)).toEqual(["agent", ...base.spans.map((s) => s.kind)]);
    expect(t.scores.map((s) => [s.scorer, s.pass])).toEqual([["exact", true], ["rag.citations", false]]);
    expect(t.pass).toBe(false);
  });

  test("errors become status code 2 and error.type", () => {
    const failed: Trial = { ...trial, trace: { ...trial.trace, error: "timeout", spans: [{ id: "s", kind: "tool", name: "Bash", startedAt: base.startedAt, attrs: { error: "exit 1" } }] } };
    const [root, tool] = trialToSpans(failed);
    expect(root!.status).toEqual({ code: 2, message: "timeout" });
    expect(attr(root!, ATTR.errorType)).toBe("timeout");
    expect(tool!.status.code).toBe(2);
    expect(attr(tool!, ATTR.toolName)).toBe("Bash");
  });
});
