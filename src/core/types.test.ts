import { describe, expect, test } from "bun:test";
import valid from "../../test/fixtures/trace.valid.json";
import { assertCase, assertTrace, isCase, isTrace, type Case, type Trace } from "./types";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe("isTrace / assertTrace", () => {
  test("accepts the valid fixture", () => {
    expect(isTrace(valid)).toBe(true);
    expect(() => assertTrace(valid)).not.toThrow();
    const t: Trace = valid as Trace;
    expect(t.messages).toHaveLength(5);
  });

  test("rejects a bad message role and names the path", () => {
    const bad = clone(valid) as { messages: { role: string }[] };
    bad.messages[2]!.role = "robot";
    expect(isTrace(bad)).toBe(false);
    expect(() => assertTrace(bad)).toThrow(/trace\.messages\[2\]\.role/);
  });

  test("rejects a missing usage block", () => {
    const bad = clone(valid) as Record<string, unknown>;
    delete bad.usage;
    expect(isTrace(bad)).toBe(false);
    expect(() => assertTrace(bad)).toThrow(/trace\.usage/);
  });

  test("rejects a span with an unknown kind", () => {
    const bad = clone(valid) as { spans: { kind: string }[] };
    bad.spans[0]!.kind = "magic";
    expect(() => assertTrace(bad)).toThrow(/trace\.spans\[0\]\.kind/);
  });

  test("rejects a tool call without a function name", () => {
    const bad = clone(valid) as { messages: { tool_calls?: { function: Record<string, unknown> }[] }[] };
    delete bad.messages[2]!.tool_calls![0]!.function.name;
    expect(() => assertTrace(bad)).toThrow(/trace\.messages\[2\]\.tool_calls\[0\]\.function\.name/);
  });

  test("rejects non-objects", () => {
    expect(isTrace(null)).toBe(false);
    expect(isTrace("trace")).toBe(false);
    expect(() => assertTrace(42)).toThrow(/trace/);
  });
});

describe("isCase / assertCase", () => {
  test("accepts a minimal case and a full case", () => {
    const minimal: Case = { id: "c1", input: "hello" };
    const full: Case = {
      id: "c2",
      input: { q: "x" },
      expected: "y",
      rubric: "Answer is y",
      tags: ["smoke"],
      cluster: "docA",
      meta: { source: "fixture" },
    };
    expect(isCase(minimal)).toBe(true);
    expect(isCase(full)).toBe(true);
  });

  test("rejects a case without id or with non-string tags", () => {
    expect(isCase({ input: "x" })).toBe(false);
    expect(() => assertCase({ id: "c", input: "x", tags: [1] })).toThrow(/case\.tags\[0\]/);
  });
});
