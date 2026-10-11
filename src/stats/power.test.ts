import { describe, expect, test } from "bun:test";
import vectors from "../../test/fixtures/stats-vectors.json";
import { pairedMde, pairedPowerN, withDesign } from "./power";

type PowerVec = { kind: string; effect: number; alpha: number; power: number; n: number };

describe("power", () => {
  test("required n and minimum detectable effect match statsmodels TTestPower", () => {
    for (const v of vectors.power as PowerVec[]) {
      if (v.kind === "paired-t") expect(pairedPowerN({ effect: v.effect, alpha: v.alpha, power: v.power })).toBeCloseTo(v.n, 1);
      if (v.kind === "paired-t-mde") expect(pairedMde({ n: v.n, alpha: v.alpha, power: v.power })).toBeCloseTo(v.effect, 3);
    }
  });

  test("monotone: more power or smaller effect needs more cases", () => {
    expect(pairedPowerN({ effect: 0.5, power: 0.9 })).toBeGreaterThan(pairedPowerN({ effect: 0.5, power: 0.8 }));
    expect(pairedPowerN({ effect: 0.2 })).toBeGreaterThan(pairedPowerN({ effect: 0.5 }));
  });

  test("design adjustments", () => {
    expect(withDesign(100, { pairingCorr: 0.5 })).toBeCloseTo(50, 9);
    expect(withDesign(100, { repeats: 4, noiseShare: 0.5 })).toBeCloseTo(62.5, 9);
    expect(withDesign(100, { icc: 0.2, avgClusterSize: 6 })).toBeCloseTo(200, 9);
    expect(withDesign(100, {})).toBe(100);
  });
});
