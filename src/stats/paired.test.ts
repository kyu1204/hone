import { describe, expect, test } from "bun:test";
import vectors from "../../test/fixtures/stats-vectors.json";
import { compareTargets, mcnemarExact, pairedDifference } from "./paired";

describe("paired difference", () => {
  test("matches scipy ttest_rel vectors", () => {
    for (const v of vectors.paired) {
      const r = pairedDifference(v.a, v.b);
      expect(r.meanDiff).toBeCloseTo(v.meanDiff, 12);
      expect(r.se).toBeCloseTo(v.se, 12);
      expect(r.t).toBeCloseTo(v.t, 9);
      expect(r.p).toBeCloseTo(v.p, 9);
      expect(r.lo).toBeCloseTo(v.lo, 6);
      expect(r.hi).toBeCloseTo(v.hi, 6);
      expect(r.corr).toBeCloseTo(v.corr, 9);
      expect(r.n).toBe(v.a.length);
    }
    expect(() => pairedDifference([1, 2], [1])).toThrow(/same length/);
    expect(pairedDifference([1, 1, 1], [0, 0, 0]).varianceReduction).toBeCloseTo(1, 12);
  });
});

describe("exact McNemar", () => {
  test("matches statsmodels vectors and handles no discordant pairs", () => {
    for (const v of vectors.mcnemar) expect(mcnemarExact(v.b, v.c).p).toBeCloseTo(v.p, 12);
    expect(mcnemarExact(0, 0).p).toBe(1);
  });
});

describe("compareTargets", () => {
  test("binary rows get McNemar, clustered rows get a cluster-robust paired SE", () => {
    const rows = [
      { caseId: "1", a: 1, b: 0, cluster: "x" },
      { caseId: "2", a: 1, b: 1, cluster: "x" },
      { caseId: "3", a: 0, b: 0, cluster: "y" },
      { caseId: "4", a: 1, b: 0, cluster: "y" },
      { caseId: "5", a: 1, b: 1, cluster: "z" },
      { caseId: "6", a: 0, b: 1, cluster: "z" },
    ];
    const r = compareTargets(rows);
    expect(r.paired.n).toBe(6);
    expect(r.paired.meanDiff).toBeCloseTo(1 / 6, 12);
    expect(r.mcnemar).toBeDefined();
    expect(r.mcnemar!.b).toBe(2);
    expect(r.mcnemar!.c).toBe(1);
    expect(r.clustered).toBeDefined();
    expect(r.clustered!.se).toBeGreaterThan(0);
    expect(r.clustered!.nClusters).toBe(3);
    const cont = compareTargets([{ caseId: "1", a: 0.5, b: 0.4 }, { caseId: "2", a: 0.9, b: 0.95 }, { caseId: "3", a: 0.7, b: 0.6 }]);
    expect(cont.mcnemar).toBeUndefined();
    expect(cont.clustered).toBeUndefined();
  });
});
