import { expect, test } from "bun:test";
import { PRICING, costOf, priceOf } from "./pricing";

test("every listed price is positive and costOf uses per-million rates", () => {
  for (const [model, p] of Object.entries(PRICING)) {
    expect(p.inputPerM).toBeGreaterThan(0);
    expect(p.outputPerM).toBeGreaterThan(0);
    expect(priceOf(model)).toBe(p);
  }
  const p = PRICING["gpt-5-mini"]!;
  expect(costOf("gpt-5-mini", 2_000_000, 1_000_000)).toBeCloseTo(2 * p.inputPerM + p.outputPerM, 9);
  expect(costOf("unknown-model", 100, 100)).toBe(0);
});
