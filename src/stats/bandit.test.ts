import { describe, expect, test } from "bun:test";
import { BetaBandit, allocate } from "./bandit";

describe("BetaBandit", () => {
  test("concentrates pulls on the best arm and estimates rates; seeded runs are identical", () => {
    const rates: Record<string, number> = { a: 0.9, b: 0.5, c: 0.3 };
    const run = (seed: number) => {
      const bandit = new BetaBandit(Object.keys(rates), seed);
      const rand = (() => {
        let s = seed;
        return () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s / 4294967296;
        };
      })();
      const pulls: Record<string, number> = { a: 0, b: 0, c: 0 };
      for (let i = 0; i < 300; i++) {
        const arm = bandit.sample();
        pulls[arm]!++;
        bandit.update(arm, rand() < rates[arm]!);
      }
      return { bandit, pulls };
    };
    const r1 = run(3);
    const r2 = run(3);
    expect(r1.pulls).toEqual(r2.pulls);
    expect(r1.pulls.a).toBeGreaterThan(150);
    expect(r1.bandit.best()).toBe("a");
    expect(Math.abs(r1.bandit.posterior("a").mean - 0.9)).toBeLessThan(0.1);
    expect(r1.bandit.posterior("c").alpha).toBeGreaterThanOrEqual(1);
  });

  test("allocate returns counts summing to the budget", () => {
    const bandit = new BetaBandit(["x", "y"], 1);
    const counts = allocate(bandit, 50);
    expect(counts.x! + counts.y!).toBe(50);
  });

  test("unknown arms are rejected", () => {
    const bandit = new BetaBandit(["x"], 1);
    expect(() => bandit.update("zzz", true)).toThrow(/unknown arm/);
  });
});
