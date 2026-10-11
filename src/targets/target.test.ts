import { describe, expect, test } from "bun:test";
import { createTarget, createTargets, knownTargetKinds, registerTargetKind } from "./index";
import { type RunContext, type Target, toTrace } from "./target";

const ctx: RunContext = { runId: "run-1", caseId: "c1", trial: 2 };

describe("toTrace", () => {
  test("fills defaults, ids and timestamps, and validates", () => {
    const started = new Date("2026-10-12T00:00:00Z");
    const ended = new Date("2026-10-12T00:00:01Z");
    const trace = toTrace({ output: "hi" }, ctx, "t1", started, ended);
    expect(trace.id).toBe("run-1_c1_t1_2");
    expect(trace.caseId).toBe("c1");
    expect(trace.targetId).toBe("t1");
    expect(trace.trial).toBe(2);
    expect(trace.messages).toEqual([]);
    expect(trace.spans).toEqual([]);
    expect(trace.usage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(trace.startedAt).toBe(started.toISOString());
    expect(trace.endedAt).toBe(ended.toISOString());
  });

  test("keeps provided messages, spans, partial usage and error", () => {
    const trace = toTrace(
      {
        output: null,
        messages: [{ role: "user", content: "q" }],
        spans: [{ id: "s", kind: "llm", name: "chat", startedAt: "2026-10-12T00:00:00Z" }],
        usage: { inputTokens: 5 },
        error: "boom",
      },
      ctx,
      "t1",
      new Date(),
      new Date(),
    );
    expect(trace.messages).toHaveLength(1);
    expect(trace.usage).toEqual({ inputTokens: 5, outputTokens: 0, costUsd: 0 });
    expect(trace.error).toBe("boom");
  });

  test("rejects malformed messages from a target", () => {
    expect(() => toTrace({ output: 1, messages: [{ role: "robot", content: "x" } as never] }, ctx, "t1", new Date(), new Date())).toThrow(/messages\[0\]\.role/);
  });
});

describe("registry", () => {
  test("unknown kind throws with the known list; registered kinds build targets", () => {
    expect(() => createTarget("x", { kind: "nope" })).toThrow(/unknown target kind "nope".*http/);
    const fake: Target = { id: "f", kind: "fake", version: async () => "v", run: async () => ({ output: 1 }) };
    registerTargetKind("fake", (id) => ({ ...fake, id }));
    expect(knownTargetKinds()).toContain("fake");
    const targets = createTargets({ a: { kind: "fake" }, b: { kind: "fake" } });
    expect(Object.keys(targets)).toEqual(["a", "b"]);
    expect(targets.a?.id).toBe("a");
  });
});
