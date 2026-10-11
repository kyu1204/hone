import { describe, expect, test } from "bun:test";
import vectors from "../../test/fixtures/stats-vectors.json";
import { bootstrapCi, meanCiClt, wilsonCi } from "./interval";

describe("intervals", () => {
  test("wilson matches errorbars vectors", () => {
    for (const v of vectors.wilson) {
      const m = wilsonCi(v.successes, v.n, v.confidence);
      expect(m.mean).toBeCloseTo(v.mean, 12);
      expect(m.se).toBeCloseTo(v.se, 9);
      expect(m.lo).toBeCloseTo(v.lo, 9);
      expect(m.hi).toBeCloseTo(v.hi, 9);
      expect(m.n).toBe(v.n);
      expect(m.method).toBe("wilson");
    }
    expect(() => wilsonCi(3, 0)).toThrow();
  });

  test("clt interval matches errorbars vectors", () => {
    for (const v of vectors.clt) {
      const m = meanCiClt(v.values, v.confidence);
      expect(m.mean).toBeCloseTo(v.mean, 12);
      expect(m.se).toBeCloseTo(v.se, 9);
      expect(m.lo).toBeCloseTo(v.lo, 9);
      expect(m.hi).toBeCloseTo(v.hi, 9);
    }
  });

  test("bootstrap is seeded, contains the mean and narrows with n", () => {
    const small = [0.2, 0.5, 0.9, 1, 0, 0.3, 0.7, 0.65];
    const a = bootstrapCi(small, { seed: 1, nBoot: 500 });
    const b = bootstrapCi(small, { seed: 1, nBoot: 500 });
    expect(a).toEqual(b);
    expect(a.lo).toBeLessThanOrEqual(a.mean);
    expect(a.hi).toBeGreaterThanOrEqual(a.mean);
    const big = bootstrapCi([...small, ...small, ...small, ...small], { seed: 1, nBoot: 500 });
    expect(big.hi - big.lo).toBeLessThan(a.hi - a.lo);
    expect(a.method).toBe("bootstrap");
  });
});
