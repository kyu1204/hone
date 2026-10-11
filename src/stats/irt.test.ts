import { describe, expect, test } from "bun:test";
import { mulberry32 } from "./dist";
import { caseNoise, fisherInformation, fit2pl, orderCasesByInformation } from "./irt";

function pearson(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

function synthetic(seed: number, nTargets = 12, nCases = 60) {
  const rand = mulberry32(seed);
  const gauss = () => {
    const u = 1 - rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const abilities = Array.from({ length: nTargets }, () => gauss());
  const difficulties = Array.from({ length: nCases }, () => gauss());
  const discriminations = Array.from({ length: nCases }, () => 0.6 + rand() * 1.4);
  const rows: { targetId: string; caseId: string; pass: boolean }[] = [];
  for (let t = 0; t < nTargets; t++)
    for (let c = 0; c < nCases; c++)
      for (let r = 0; r < 3; r++) {
        const p = 1 / (1 + Math.exp(-discriminations[c]! * (abilities[t]! - difficulties[c]!)));
        rows.push({ targetId: `t${t}`, caseId: `c${c}`, pass: rand() < p });
      }
  return { abilities, difficulties, discriminations, rows };
}

describe("2PL IRT", () => {
  test("recovers difficulties and ability ranking from synthetic data", () => {
    const { abilities, difficulties, rows } = synthetic(11);
    const t0 = performance.now();
    const fit = fit2pl(rows);
    expect(performance.now() - t0).toBeLessThan(3000);
    const estD = difficulties.map((_, i) => fit.cases[`c${i}`]!.difficulty);
    expect(pearson(estD, difficulties)).toBeGreaterThan(0.9);
    const estA = abilities.map((_, i) => fit.targets[`t${i}`]!.ability);
    expect(pearson(estA, abilities)).toBeGreaterThan(0.9);
    expect(Object.values(fit.cases).every((c) => c.discrimination > 0)).toBe(true);
    expect(Number.isFinite(fit.logLik)).toBe(true);
  });

  test("information ordering puts items near the target ability first", () => {
    const { rows } = synthetic(5);
    const fit = fit2pl(rows);
    const t = "t0";
    const ordered = orderCasesByInformation(fit, t);
    expect(ordered).toHaveLength(60);
    const info = (c: string) => fisherInformation(fit.targets[t]!.ability, fit.cases[c]!);
    expect(info(ordered[0]!)).toBeGreaterThanOrEqual(info(ordered[59]!));
    expect(fisherInformation(0, { difficulty: 0, discrimination: 1 })).toBeCloseTo(0.25, 12);
  });

  test("caseNoise flags all-pass or all-fail low-discrimination cases as regression only", () => {
    const rows = [
      ...["t1", "t2", "t3"].flatMap((t) => [0, 1, 2].map(() => ({ targetId: t, caseId: "easy", pass: true }))),
      ...["t1", "t2", "t3"].flatMap((t) => [0, 1, 2].map((r) => ({ targetId: t, caseId: "noisy", pass: r === 0 }))),
    ];
    const noise = caseNoise(rows, { easy: { difficulty: -3, discrimination: 0.1 }, noisy: { difficulty: 0, discrimination: 1 } });
    expect(noise.easy!.regressionOnly).toBe(true);
    expect(noise.easy!.noise).toBe(0);
    expect(noise.noisy!.regressionOnly).toBe(false);
    expect(noise.noisy!.noise).toBeGreaterThan(0.2);
  });
});
