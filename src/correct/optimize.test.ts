import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HoneConfig } from "../core/config";
import { BetaBandit } from "../stats/bandit";
import { optimize, probBest } from "./optimize";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function config(pBaseline: number, pBetter: number): HoneConfig {
  const arm = (p: number, seed: number, version: string) => {
    const rand = mulberry32(seed);
    return { t: { kind: "fn", fn: (i: unknown) => (rand() < p ? String(i).toUpperCase() : String(i)), version } };
  };
  return {
    targets: arm(pBaseline, 1, "baseline"),
    cases: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, input: `w${i}`, expected: `W${i}` })),
    scorers: [{ name: "exact" }],
    optimize: { better: (c) => ({ ...c, targets: arm(pBetter, 2, "better") }) },
  };
}

describe("probBest", () => {
  test("a clearly better posterior takes almost all the mass", () => {
    const b = new BetaBandit(["a", "b"], 1);
    for (let i = 0; i < 20; i++) b.update("a", i < 18);
    for (let i = 0; i < 20; i++) b.update("b", i < 4);
    const p = probBest(b, 2000);
    expect(p.a).toBeGreaterThan(0.99);
    expect(p.a! + p.b!).toBeCloseTo(1, 9);
  });
});

describe("optimize", () => {
  test("Thompson sampling spends most trials on the better arm, stops on confidence, and the paired verdict agrees", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hone-opt-"));
    dirs.push(cwd);
    const r = await optimize({ config: config(0.1, 1), hash: "h", cwd, budget: 60, batch: 10, seed: 3, minPerArm: 4, useCache: false });
    const arms = Object.fromEntries(r.arms.map((a) => [a.id, a]));
    expect(arms.better!.banditTrials).toBeGreaterThan(arms.baseline!.banditTrials);
    expect(arms.better!.trials).toBeGreaterThanOrEqual(arms.baseline!.trials);
    expect(arms.baseline!.trials).toBeGreaterThanOrEqual(4);
    expect(r.stopped).toBe("confidence");
    expect(r.spent).toBeLessThan(60);
    expect(arms.better!.probBest).toBeGreaterThan(0.95);
    expect(r.verdict).toMatch(/^better beats baseline/);
    expect(r.file.kind).toBe("optimize");
    expect(r.file.baseline.id).toBe("baseline");
    expect(r.file.candidates[0]).toMatchObject({ id: "better", text: "better", pareto: true });
    expect(r.file.candidates[0]!.lo).toBeGreaterThan(0.5);
    expect(fs.existsSync(path.join(cwd, ".hone", "optimize", `${r.id}.json`))).toBe(true);
    expect(arms.baseline!.cases).toBe(12);
    expect(arms.better!.cases).toBe(12);
    expect(r.verified).toBeGreaterThan(0);
  });

  test("equal arms exhaust the budget and report no measurable effect", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hone-opt2-"));
    dirs.push(cwd);
    const r = await optimize({ config: config(0.5, 0.5), hash: "h", cwd, budget: 20, batch: 10, seed: 5, useCache: false });
    expect(r.stopped).toBe("budget");
    expect(r.spent).toBe(20);
    expect(r.verified).toBeGreaterThanOrEqual(0);
    expect(r.verdict).toMatch(/no measurable effect|baseline holds/);
  });

  test("config without the optimize hook throws", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hone-opt3-"));
    dirs.push(cwd);
    const { optimize: _o, ...cfg } = config(0.5, 0.5);
    await expect(optimize({ config: cfg, hash: "h", cwd })).rejects.toThrow(/optimize/);
  });
});
