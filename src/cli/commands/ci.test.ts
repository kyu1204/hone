import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ciCommand } from "./ci";
import type { CommandIo } from "./run";

const configModule = new URL("../../core/config.ts", import.meta.url).pathname;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function io(cwd: string, env: Record<string, string> = {}): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}

function project(passing: number, gates = ""): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-ci-"));
  dirs.push(d);
  fs.writeFileSync(
    path.join(d, "hone.config.ts"),
    `import { defineConfig } from ${JSON.stringify(configModule)};
export default defineConfig({
  targets: { t: { kind: "fn", fn: (i) => (Number(String(i).slice(1)) < ${passing} ? "ok" : "bad"), version: "v${passing}" } },
  cases: Array.from({ length: 10 }, (_, i) => ({ id: "c" + i, input: "c" + i, expected: "ok" })),
  trials: 1,
  scorers: [{ name: "exact" }],
  ${gates}
});
`,
  );
  return d;
}

describe("hone test --ci", () => {
  test("passing gates exit 0 and write .hone/ci/last.json and JUnit", async () => {
    const dir = project(10, "gates: { passAt1: { min: 0.9 }, costUsd: { max: 1 } },");
    const o = io(dir);
    expect(await ciCommand(["--quiet", "--junit", "junit.xml"], o)).toBe(0);
    const last = JSON.parse(fs.readFileSync(path.join(dir, ".hone", "ci", "last.json"), "utf8")) as { schemaVersion: number; gates: { name: string; pass: boolean }[] };
    expect(last.schemaVersion).toBe(1);
    expect(last.gates.map((g) => g.name)).toEqual(["passAt1", "costUsd"]);
    expect(last.gates.every((g) => g.pass)).toBe(true);
    const xml = fs.readFileSync(path.join(dir, "junit.xml"), "utf8");
    expect(xml).toContain("<testsuite");
    expect((xml.match(/<testcase /g) ?? []).length).toBe(10);
    expect(xml).not.toContain("<failure");
    expect(o.out).toMatch(/passAt1/);
  });

  test("a failing gate exits 1 naming the axis; JUnit carries failures", async () => {
    const dir = project(6);
    const o = io(dir);
    expect(await ciCommand(["--quiet", "--min-pass-at-1", "0.8", "--junit", "j.xml"], o)).toBe(1);
    expect(o.err).toMatch(/gate passAt1/);
    const xml = fs.readFileSync(path.join(dir, "j.xml"), "utf8");
    expect((xml.match(/<failure/g) ?? []).length).toBe(4);
  });

  test("regression against a baseline run and the markdown comment", async () => {
    const dir = project(10);
    const first = io(dir);
    expect(await ciCommand(["--quiet"], first)).toBe(0);
    const baseline = JSON.parse(fs.readFileSync(path.join(dir, ".hone", "ci", "last.json"), "utf8")) as { runId: string };
    fs.writeFileSync(path.join(dir, "hone.config.ts"), fs.readFileSync(path.join(dir, "hone.config.ts"), "utf8").replace("< 10 ?", "< 5 ?").replace('version: "v10"', 'version: "v5"'));
    const second = io(dir);
    expect(await ciCommand(["--quiet", "--baseline", baseline.runId, "--max-regression", "0.2", "--comment"], second)).toBe(1);
    expect(second.err).toMatch(/gate regression/);
    expect(second.out).toMatch(/\| gate \|/);
    expect(second.out).toMatch(/regression/);
    expect(second.out).toMatch(/❌|✅/);
  });

  test("min-pass-hat-k gate and config errors", async () => {
    const dir = project(10);
    // pass^3 needs at least 3 trials per cell
    expect(await ciCommand(["--quiet", "--trials", "3", "--min-pass-hat-k", "3:0.5"], io(dir))).toBe(0);
    const tooFew = io(dir);
    expect(await ciCommand(["--quiet", "--trials", "1", "--min-pass-hat-k", "3:0.5"], tooFew)).toBe(1);
    expect(tooFew.err).toMatch(/passHatK/);
    const bad = io(dir);
    expect(await ciCommand(["--min-pass-hat-k", "nonsense"], bad)).toBe(2);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "hone-ci-empty-"));
    dirs.push(empty);
    expect(await ciCommand([], io(empty))).toBe(2);
  });
});
