import { describe, expect, test } from "bun:test";
import { MUTATIONS, mutate } from "./mutations";

describe("mutations", () => {
  test("paraphrase rewrites with a fixed table and is deterministic", () => {
    const a = mutate("paraphrase", "What is the capital of France?", 0);
    const b = mutate("paraphrase", "What is the capital of France?", 0);
    expect(a).toBe(b);
    expect(a).not.toBe("What is the capital of France?");
    expect(String(a).toLowerCase()).toContain("capital of france");
    expect(mutate("paraphrase", "What is the capital of France?", 1)).not.toBe(a);
  });

  test("reorder swaps clauses and keeps content", () => {
    const out = String(mutate("reorder", "Explain the policy; include the start date", 0));
    expect(out).toContain("include the start date");
    expect(out).toContain("Explain the policy");
    expect(out.indexOf("include")).toBeLessThan(out.indexOf("Explain"));
    expect(mutate("reorder", "single clause", 0)).toBeUndefined();
  });

  test("noise appends an irrelevant sentence to strings and a key to objects", () => {
    const s = String(mutate("noise", "When does it start?", 0));
    expect(s.startsWith("When does it start?")).toBe(true);
    expect(s.length).toBeGreaterThan("When does it start?".length + 5);
    const o = mutate("noise", { q: "x" }, 0) as Record<string, unknown>;
    expect(o.q).toBe("x");
    expect(o._irrelevant).toBeDefined();
    expect(mutate("paraphrase", { q: "x" }, 0)).toBeUndefined();
  });

  test("every mutation name is listed", () => {
    expect(MUTATIONS).toEqual(["paraphrase", "reorder", "noise"]);
  });
});
