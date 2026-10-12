import { describe, expect, test } from "bun:test";
import valid from "../../test/fixtures/trace.valid.json";
import type { Trace } from "../core/types";
import { createScorer } from "./index";
import { runScorer } from "./scorer";

const base = valid as Trace;

describe("fn scorer", () => {
  test("an inline function receives the score context and returns a (possibly async) score", async () => {
    const s = createScorer({ name: "fn", id: "my-check", score: async ({ trace, case: c }: { trace: Trace; case: { id: string } }) => ({ value: trace.caseId === c.id ? 1 : 0, pass: true, reason: "ids match" }) });
    expect(s.name).toBe("my-check");
    const out = await runScorer(s, { case: { id: base.caseId, input: "q" }, trace: base, trial: 0 });
    expect(out).toMatchObject({ scorer: "my-check", value: 1, pass: true, reason: "ids match" });
  });
  test("a bare number is a value with pass by threshold; a boolean is pass/fail; errors are reported", async () => {
    expect(await runScorer(createScorer({ name: "fn", score: () => 0.9 }), { case: { id: "c", input: "" }, trace: base, trial: 0 })).toMatchObject({ scorer: "fn", value: 0.9, pass: true });
    expect(await runScorer(createScorer({ name: "fn", score: () => 0.2, threshold: 0.5 }), { case: { id: "c", input: "" }, trace: base, trial: 0 })).toMatchObject({ value: 0.2, pass: false });
    expect(await runScorer(createScorer({ name: "fn", score: () => false }), { case: { id: "c", input: "" }, trace: base, trial: 0 })).toMatchObject({ value: 0, pass: false });
    expect(await runScorer(createScorer({ name: "fn", score: () => { throw new Error("boom"); } }), { case: { id: "c", input: "" }, trace: base, trial: 0 })).toMatchObject({ pass: null, reason: expect.stringMatching(/boom/) });
    expect(() => createScorer({ name: "fn" })).toThrow(/`score` function/);
  });
  test("fn scorers are never cached unless cacheKey is given", () => {
    const s = createScorer({ name: "fn", score: () => 1 });
    expect(s.cacheKeyExtra?.()).toBe(Symbol.for("no-cache"));
    const keyed = createScorer({ name: "fn", score: () => 1, cacheKey: "v2" });
    expect(keyed.cacheKeyExtra?.()).toEqual({ cacheKey: "v2" });
  });
});
