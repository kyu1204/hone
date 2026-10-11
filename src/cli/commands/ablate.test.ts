import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ablateCommand } from "./ablate";
import type { CommandIo } from "./run";

const configModule = new URL("../../core/config.ts", import.meta.url).pathname;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function io(cwd: string): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env: {}, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}

function project(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-ablate-"));
  dirs.push(d);
  fs.writeFileSync(
    path.join(d, "hone.config.ts"),
    `import { defineConfig } from ${JSON.stringify(configModule)};
export default defineConfig({
  targets: { t: { kind: "fn", fn: (i) => String(i).toUpperCase(), version: "with-upper" } },
  cases: Array.from({ length: 8 }, (_, i) => ({ id: "c" + i, input: "w" + i, expected: "W" + i })),
  trials: 1,
  scorers: [{ name: "exact" }],
  ablations: {
    "no-upper": (c) => ({ ...c, targets: { t: { kind: "fn", fn: (i) => String(i), version: "without-upper" } } }),
    "same": (c) => ({ ...c }),
  },
});
`,
  );
  return d;
}

describe("hone ablate", () => {
  test("reports what each component contributes with a verdict", async () => {
    const dir = project();
    const o = io(dir);
    expect(await ablateCommand(["--json"], o)).toBe(0);
    const doc = JSON.parse(o.out) as { baseline: { passAt1: number }; ablations: { name: string; passAt1: number; delta: number; p: number; verdict: string }[] };
    expect(doc.baseline.passAt1).toBe(1);
    const noUpper = doc.ablations.find((a) => a.name === "no-upper")!;
    expect(noUpper.passAt1).toBe(0);
    expect(noUpper.delta).toBe(-1);
    expect(noUpper.verdict).toBe("component helps");
    const same = doc.ablations.find((a) => a.name === "same")!;
    expect(same.delta).toBe(0);
    expect(same.verdict).toBe("no measurable effect");
    expect(doc.ablations[0]!.name).toBe("no-upper");
    const text = io(dir);
    await ablateCommand(["no-upper"], text);
    expect(text.out).toMatch(/no-upper/);
    expect(text.out).toMatch(/component helps/);
    // 3 runs for the json call (baseline + 2 ablations) and 2 for the text call (baseline + 1)
    expect(fs.readdirSync(path.join(dir, ".hone", "runs"))).toHaveLength(5);
  });

  test("unknown ablation names and configs without ablations are usage errors", async () => {
    const dir = project();
    const o = io(dir);
    expect(await ablateCommand(["nope"], o)).toBe(2);
    expect(o.err).toMatch(/nope/);
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "hone-ablate-bare-"));
    dirs.push(bare);
    fs.writeFileSync(path.join(bare, "hone.config.ts"), "export default { targets: { t: { kind: 'fn', fn: () => 1 } }, cases: [{ id: 'a', input: 1 }], scorers: [] };\n");
    const b = io(bare);
    expect(await ablateCommand([], b)).toBe(2);
    expect(b.err).toMatch(/ablations/);
  });
});
