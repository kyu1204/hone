import { describe, expect, test } from "bun:test";
import { createTarget } from "./index";
import type { FnContext } from "./fn";
import type { RunContext } from "./target";

const ctx: RunContext = { runId: "r", caseId: "c1", trial: 0 };

describe("fn target", () => {
  test("plain return becomes output; caseId and trial are visible", async () => {
    const t = createTarget("f", { kind: "fn", fn: (input: unknown, c: FnContext) => `${String(input)}:${c.caseId}:${c.trial}` });
    const out = await t.run("x", ctx);
    expect(out.output).toBe("x:c1:0");
    expect(out.messages).toEqual([]);
    expect(out.spans).toEqual([]);
  });

  test("nested spans record parentId, timing, input, output and attrs", async () => {
    const t = createTarget("f", {
      kind: "fn",
      fn: async (_input: unknown, c: FnContext) =>
        c.span("agent", "root", async () => {
          const docs = await c.span("retrieval", "search", async (s) => {
            s.input({ q: "x" });
            s.attr("topK", 3);
            s.output(["d1"]);
            return ["d1"];
          });
          c.message({ role: "user", content: "x" });
          c.message({ role: "assistant", content: "answer" });
          c.usage({ inputTokens: 10 });
          c.usage({ inputTokens: 5, costUsd: 0.01 });
          return `answer from ${docs.join()}`;
        }),
    });
    const out = await t.run("x", ctx);
    expect(out.output).toBe("answer from d1");
    expect(out.spans).toHaveLength(2);
    const [root, search] = out.spans!;
    expect(root!.name).toBe("root");
    expect(search!.parentId).toBe(root!.id);
    expect(search!.input).toEqual({ q: "x" });
    expect(search!.output).toEqual(["d1"]);
    expect(search!.attrs).toEqual({ topK: 3 });
    expect(Date.parse(search!.endedAt!)).toBeGreaterThanOrEqual(Date.parse(search!.startedAt));
    expect(out.messages).toHaveLength(2);
    expect(out.usage).toEqual({ inputTokens: 15, costUsd: 0.01 });
  });

  test("an error inside a span ends the span with attrs.error and becomes TargetOutput.error", async () => {
    const t = createTarget("f", {
      kind: "fn",
      fn: (_i: unknown, c: FnContext) =>
        c.span("tool", "boom", () => {
          throw new Error("kaput");
        }),
    });
    const out = await t.run("x", ctx);
    expect(out.error).toMatch(/kaput/);
    expect(out.output).toBeNull();
    expect(out.spans?.[0]?.attrs?.error).toMatch(/kaput/);
    expect(out.spans?.[0]?.endedAt).toBeDefined();
  });

  test("a returned TargetOutput is merged with the recorder", async () => {
    const t = createTarget("f", {
      kind: "fn",
      fn: async (_i: unknown, c: FnContext) => {
        await c.span("llm", "chat", () => 1);
        return { output: "o", messages: [{ role: "assistant", content: "m" }], usage: { outputTokens: 2 }, artifacts: { stdout: "log" } };
      },
    });
    const out = await t.run("x", ctx);
    expect(out.output).toBe("o");
    expect(out.spans).toHaveLength(1);
    expect(out.messages).toEqual([{ role: "assistant", content: "m" }]);
    expect(out.usage).toEqual({ outputTokens: 2 });
    expect(out.artifacts).toEqual({ stdout: "log" });
  });

  test("resume seeds the prefix and version follows the function body", async () => {
    const spec = { kind: "fn", fn: (_i: unknown, c: FnContext) => (c.prefix ? `continued ${c.prefix.length}` : "fresh") };
    const t = createTarget("f", spec);
    const prefix = [{ role: "user" as const, content: "earlier" }];
    const out = await t.resume!(prefix, "x", ctx);
    expect(out.output).toBe("continued 1");
    expect(out.messages?.[0]).toEqual(prefix[0]);
    const v1 = await t.version();
    const v2 = await createTarget("f", { kind: "fn", fn: () => "different" }).version();
    expect(v1).not.toBe(v2);
    expect(await createTarget("f", { ...spec, version: "pinned" }).version()).toBe("pinned");
  });
});
