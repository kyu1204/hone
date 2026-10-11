import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { importInspect, inspectScore, parseInspectJson } from "./inspect";

const fixture = new URL("../../../test/fixtures/import/inspect.json", import.meta.url).pathname;

describe("inspect import", () => {
  test("parseInspectJson tolerates NaN and Infinity tokens", () => {
    expect(parseInspectJson('{"a": NaN, "b": [1, Infinity, -Infinity], "s": "NaN"}')).toEqual({ a: null, b: [1, null, null], s: "NaN" });
  });
  test("inspectScore maps letters, numbers and booleans", () => {
    expect(inspectScore("m", { value: "C" })).toMatchObject({ value: 1, pass: true });
    expect(inspectScore("m", { value: "I", explanation: "x" })).toMatchObject({ value: 0, pass: false, reason: "x" });
    expect(inspectScore("m", { value: "P" })).toMatchObject({ value: 0.5, pass: null });
    expect(inspectScore("m", { value: 0.9 })).toMatchObject({ value: 0.9, pass: null });
    expect(inspectScore("m", { value: null })).toMatchObject({ value: 0, pass: null });
  });
  test("one trace per sample per epoch with OpenAI-shaped messages, scores, usage and cases", () => {
    const { cases, trials } = importInspect(parseInspectJson(fs.readFileSync(fixture, "utf8")), { runId: "r" });
    expect(cases.map((c) => c.id)).toEqual(["q1", "q2"]);
    expect(cases[0]).toMatchObject({ input: "When does the policy start?", expected: "2026-07-01", tags: ["inspect", "policy_qa"] });
    expect(trials).toHaveLength(2);
    const [a, b] = trials;
    expect(a!.trace).toMatchObject({ caseId: "q1", targetId: "openai/gpt-5", trial: 0, output: "2026-07-01", startedAt: "2026-10-12T00:00:01Z" });
    expect(a!.trace.messages[2]!.tool_calls).toEqual([{ id: "c1", type: "function", function: { name: "search", arguments: '{"q":"policy start"}' } }]);
    expect(a!.trace.messages[3]).toMatchObject({ role: "tool", tool_call_id: "c1", name: "search" });
    expect(a!.trace.messages[4]!.content).toBe("2026-07-01");
    expect(a!.scores).toEqual([{ scorer: "match", value: 1, pass: true, reason: "exact" }, { scorer: "faith", value: 0.9, pass: null, reason: "supported" }]);
    expect(a!.pass).toBe(true);
    expect(a!.trace.usage).toEqual({ inputTokens: 120, outputTokens: 8, costUsd: 0.0012 });
    expect(a!.trace.meta).toMatchObject({ inspect: { task: "policy_qa", run_id: "run-7" }, model: "gpt-5" });
    expect(b!.trace.trial).toBe(1);
    expect(b!.pass).toBe(false);
    expect(b!.scores[1]).toMatchObject({ scorer: "faith", pass: null });
    expect(a!.id).toContain("r");
    expect(() => importInspect({ eval: {} })).toThrow(/samples/);
  });
});
