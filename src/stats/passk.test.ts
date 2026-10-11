import { describe, expect, test } from "bun:test";
import vectors from "../../test/fixtures/stats-vectors.json";
import { logChoose, passAtK, passHatK, verdictFor } from "./passk";

describe("pass@k and pass^k", () => {
  test("match the combinatorial vectors", () => {
    for (const v of vectors.passk) {
      expect(passHatK(v.n, v.c, v.k)).toBeCloseTo(v.passHatK, 12);
      expect(passAtK(v.n, v.c, v.k)).toBeCloseTo(v.passAtK, 12);
    }
  });

  test("k = 1 gives the plain rate; k > n is rejected; large n stays finite", () => {
    expect(passHatK(10, 7, 1)).toBeCloseTo(0.7, 12);
    expect(passAtK(10, 7, 1)).toBeCloseTo(0.7, 12);
    expect(() => passHatK(3, 2, 4)).toThrow();
    expect(Math.exp(logChoose(2000, 1000))).toBeGreaterThan(0);
    expect(passHatK(2000, 1500, 5)).toBeGreaterThan(0.2);
  });

  test("verdictFor builds a Verdict with pass^k for several k and a Wilson interval", () => {
    const v = verdictFor("c1", "rag", [true, true, false, true, true], [1, 2, 3]);
    expect(v.n).toBe(5);
    expect(v.passes).toBe(4);
    expect(v.passAt1).toBeCloseTo(0.8, 12);
    expect(v.passHatK[2]).toBeCloseTo(6 / 10, 12);
    expect(v.passHatK[3]).toBeCloseTo(4 / 10, 12);
    expect(v.ci[0]).toBeLessThan(0.8);
    expect(v.ci[1]).toBeGreaterThan(0.8);
    const empty = verdictFor("c1", "rag", []);
    expect(empty.n).toBe(0);
    expect(empty.ci).toEqual([0, 1]);
  });
});
