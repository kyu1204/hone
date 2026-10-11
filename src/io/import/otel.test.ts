import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { attrsOf, importOtel, spansOf } from "./otel";

const fixture = new URL("../../../test/fixtures/import/otel.json", import.meta.url).pathname;

describe("otel import", () => {
  test("attribute lists and plain objects", () => {
    expect(attrsOf([{ key: "a", value: { stringValue: "x" } }, { key: "n", value: { intValue: "3" } }, { key: "b", value: { boolValue: true } }, { key: "l", value: { arrayValue: { values: [{ doubleValue: 0.5 }] } } }])).toEqual({ a: "x", n: 3, b: true, l: [0.5] });
    expect(attrsOf({ a: 1 })).toEqual({ a: 1 });
    expect(spansOf({ spans: [{ spanId: "1" }] })).toHaveLength(1);
    expect(() => spansOf({})).toThrow(/OTel/);
  });
  test("one trace per trace id: root messages, kinds, evaluations, usage, errors", () => {
    const { cases, trials } = importOtel(JSON.parse(fs.readFileSync(fixture, "utf8")), { runId: "r" });
    expect(cases).toEqual([{ id: "conv-9", input: "Summarise the policy", tags: ["otel"] }]);
    const t = trials[0]!;
    expect(t.trace.targetId).toBe("policy-bot");
    expect(t.trace.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(t.trace.output).toBe("The policy starts on 2026-07-01 [c1].");
    expect(t.trace.spans.map((s) => s.kind)).toEqual(["agent", "retrieval", "llm", "tool"]);
    const retrieval = t.trace.spans[1]!;
    expect(retrieval).toMatchObject({ name: "docs", parentId: "r1", input: "policy start" });
    expect(retrieval.output).toEqual([{ id: "c1", text: "The policy starts on 2026-07-01." }]);
    expect(t.trace.spans[3]).toMatchObject({ name: "calc", input: { x: 1 }, output: 2 });
    expect(t.trace.spans[3]!.attrs?.error).toBe("boom");
    expect(t.scores).toEqual([{ scorer: "faithfulness", value: 0.9, pass: true }, { scorer: "citations", value: 0, pass: false }]);
    expect(t.pass).toBe(false);
    expect(t.trace.usage).toEqual({ inputTokens: 300, outputTokens: 40, costUsd: 0 });
    expect(t.trace.startedAt).toBe("2026-10-12T02:00:00.000Z");
    expect(t.trace.endedAt).toBe("2026-10-12T02:00:02.000Z");
    expect(t.trace.meta).toMatchObject({ otel: { traceId: "a1", rootSpanId: "r1" }, model: "gpt-5" });
  });
});
