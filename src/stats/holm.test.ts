import { describe, expect, test } from "bun:test";
import vectors from "../../test/fixtures/stats-vectors.json";
import { holm, leaderboard } from "./holm";

describe("holm", () => {
  test("matches statsmodels adjusted p-values and rejections", () => {
    for (const v of vectors.holm) {
      const r = holm(v.p, 0.05);
      r.adjusted.forEach((x, i) => expect(x).toBeCloseTo(v.adjusted[i]!, 12));
      expect(r.reject).toEqual(v.reject);
    }
    expect(holm([], 0.05)).toEqual({ adjusted: [], reject: [] });
  });
});

describe("leaderboard", () => {
  test("groups targets that are not significantly different; a target may sit in two groups", () => {
    const n = 40;
    const A = Array.from({ length: n }, (_, i) => (i % 10 === 0 ? 0 : 1));
    const B = Array.from({ length: n }, (_, i) => (i % 10 === 1 ? 0 : 1));
    const C = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0 : 1));
    const lb = leaderboard({ A, B, C });
    expect(lb.order.slice(0, 2).sort()).toEqual(["A", "B"]);
    expect(lb.order[2]).toBe("C");
    expect(lb.pairwise).toHaveLength(3);
    const ab = lb.pairwise.find((p) => (p.a === "A" && p.b === "B") || (p.a === "B" && p.b === "A"))!;
    expect(ab.significant).toBe(false);
    const ac = lb.pairwise.find((p) => [p.a, p.b].includes("C") && [p.a, p.b].includes("A"))!;
    expect(ac.significant).toBe(true);
    expect(lb.groups).toEqual([["A", "B"], ["C"]].map((g) => expect.arrayContaining(g)));
    const D = Array.from({ length: n }, (_, i) => (i % 4 === 0 ? 0 : 1));
    const overlap = leaderboard({ A, C, D });
    const inGroups = overlap.groups.filter((g) => g.includes("D")).length;
    expect(inGroups).toBeGreaterThanOrEqual(1);
  });
});
