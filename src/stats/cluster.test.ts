import { describe, expect, test } from "bun:test";
import vectors from "../../test/fixtures/stats-vectors.json";
import { clusterRobustSe, designEffect, intraclassCorrelation, withinBetweenVariance } from "./cluster";

type ClusterVec = { values: number[]; clusters?: string[]; question_ids?: string[]; se?: number; icc?: number; design_effect?: number; within?: number; between?: number };

describe("clustered standard errors", () => {
  test("CR1 SE, ICC and design effect match errorbars", () => {
    for (const v of vectors.cluster as ClusterVec[]) {
      if (v.clusters) {
        expect(clusterRobustSe(v.values, v.clusters)).toBeCloseTo(v.se!, 12);
        const icc = intraclassCorrelation(v.values, v.clusters);
        expect(icc).toBeCloseTo(v.icc!, 12);
        expect(designEffect(icc, 4)).toBeCloseTo(v.design_effect!, 12);
      }
      if (v.question_ids) {
        const [within, between] = withinBetweenVariance(v.values, v.question_ids);
        expect(within).toBeCloseTo(v.within!, 12);
        expect(between).toBeCloseTo(v.between!, 12);
      }
    }
  });

  test("a single cluster falls back to the CLT SE; singletons give ICC 0", () => {
    const vals = [1, 0, 1, 1];
    expect(clusterRobustSe(vals, ["a", "a", "a", "a"])).toBeCloseTo(Math.sqrt(0.25 * 3 / (4 * 3) / 1) || 0.25, 6);
    expect(intraclassCorrelation(vals, ["a", "b", "c", "d"])).toBe(0);
  });
});
