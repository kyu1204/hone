import { describe, expect, test } from "bun:test";
import vectors from "../../test/fixtures/stats-vectors.json";
import { normalCdf, normalQuantile, regularizedIncompleteBeta, tForConfidence, tTwoSidedP, zForConfidence } from "./dist";

type Dist = { t_for_confidence?: { confidence: number; dof: number; value: number }; t_two_sided_p?: { t: number; dof: number; value: number }; z_for_confidence?: { confidence: number; value: number } };

describe("distributions", () => {
  test("normal quantile and cdf are inverses and match z_for_confidence", () => {
    for (const p of [0.001, 0.025, 0.3, 0.5, 0.8, 0.975, 0.999]) expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 9);
    for (const d of vectors.dist as Dist[]) if (d.z_for_confidence) expect(zForConfidence(d.z_for_confidence.confidence)).toBeCloseTo(d.z_for_confidence.value, 9);
  });

  test("t quantiles and two-sided p match errorbars", () => {
    for (const d of vectors.dist as Dist[]) {
      if (d.t_for_confidence) expect(tForConfidence(d.t_for_confidence.confidence, d.t_for_confidence.dof)).toBeCloseTo(d.t_for_confidence.value, 6);
      if (d.t_two_sided_p) expect(tTwoSidedP(d.t_two_sided_p.t, d.t_two_sided_p.dof)).toBeCloseTo(d.t_two_sided_p.value, 9);
    }
    expect(tTwoSidedP(0, 5)).toBeCloseTo(1, 12);
  });

  test("regularized incomplete beta known values", () => {
    expect(regularizedIncompleteBeta(1, 1, 0.3)).toBeCloseTo(0.3, 12);
    expect(regularizedIncompleteBeta(2, 3, 0.5)).toBeCloseTo(0.6875, 12);
    expect(regularizedIncompleteBeta(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 9);
  });
});
