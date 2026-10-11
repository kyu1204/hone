import { describe, expect, test } from "bun:test";
import { powerCommand } from "./power";
import type { CommandIo } from "./run";

function io(): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd: process.cwd(), env: {}, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}

describe("hone power", () => {
  test("required pairs for an effect, with design adjustments", async () => {
    const o = io();
    expect(await powerCommand(["--effect", "0.5"], o)).toBe(0);
    expect(o.out).toMatch(/33\.\d pairs|34 pairs|33 pairs/);
    const adj = io();
    await powerCommand(["--effect", "0.5", "--pairing-corr", "0.5", "--repeats", "4"], adj);
    expect(adj.out).toMatch(/after design adjustments/);
    const j = io();
    await powerCommand(["--effect", "0.5", "--json"], j);
    expect(JSON.parse(j.out)).toMatchObject({ mode: "n", effect: 0.5, alpha: 0.05, power: 0.8 });
  });

  test("minimum detectable effect for n", async () => {
    const o = io();
    expect(await powerCommand(["--n", "50"], o)).toBe(0);
    expect(o.out).toMatch(/minimum detectable effect/);
    expect(o.out).toMatch(/0\.40/);
  });

  test("usage errors", async () => {
    const o = io();
    expect(await powerCommand([], o)).toBe(2);
    expect(o.err).toMatch(/--effect or --n/);
  });
});
