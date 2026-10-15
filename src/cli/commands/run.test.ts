import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type CommandIo, runCommand } from "./run";

const configModule = new URL("../../core/config.ts", import.meta.url).pathname;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function project(configBody: string, cases: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-run-"));
  dirs.push(d);
  fs.mkdirSync(path.join(d, "evals"));
  fs.writeFileSync(path.join(d, "hone.config.ts"), `import { defineConfig } from ${JSON.stringify(configModule)};\nexport default defineConfig(${configBody});\n`);
  fs.writeFileSync(path.join(d, "evals", "cases.yaml"), cases);
  return d;
}

function io(cwd: string): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env: {} as Record<string, string>, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}
// biome-ignore lint: intentional control character for ANSI escapes
// oxlint-disable-next-line no-control-regex
const strip = (s: string): string => s.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

const CASES = `- id: greet\n  input: hello\n  expected: HELLO\n  tags: [smoke]\n- id: shout\n  input: bye\n  expected: BYE\n- id: fail\n  input: x\n  expected: nope\n  tags: [hard]\n`;
const CONFIG = `{
  targets: {
    up: { kind: "fn", fn: (i) => String(i).toUpperCase() },
    echo: { kind: "fn", fn: (i) => String(i) },
  },
  cases: "evals/*.yaml",
  trials: 2,
  concurrency: 2,
  scorers: [{ name: "exact" }],
}`;

describe("hone test", () => {
  test("prints a matrix, writes the run, exits 0 without gates", async () => {
    const dir = project(CONFIG, CASES);
    const o = io(dir);
    const code = await runCommand(["--quiet"], o);
    expect(code).toBe(0);
    const out = strip(o.out);
    expect(out).toContain("greet");
    expect(out).toContain("up");
    expect(out).toContain("echo");
    expect(out).toMatch(/●●\s+1\.00/);
    expect(out).toMatch(/○○\s+0\.00/);
    expect(out).toMatch(/pass\^/i);
    expect(fs.existsSync(path.join(dir, ".hone", "index.sqlite"))).toBe(true);
    expect(fs.readdirSync(path.join(dir, ".hone", "runs"))).toHaveLength(1);
  });

  test("on a terminal the matrix is colored and the pass rate has a bar; piped, it stays plain", async () => {
    const dir = project(CONFIG, CASES);
    const o = { ...io(dir), color: true };
    let out = "";
    o.stdout = (s: string) => void (out += s);
    await runCommand(["--quiet"], o);
    expect(out).toContain("\x1b[32m●");
    expect(strip(out)).toMatch(/pass@1 0\.33 ███░░░░░░░/);
    expect(strip(out)).toMatch(/┌─+┬/); // a bordered table
    expect(strip(out)).toMatch(/│ greet\s+│/);
    const plain = io(dir);
    await runCommand(["--quiet"], plain);
    expect(plain.out).not.toContain("\x1b[");
  });

  test("--report writes the HTML report of the run it just made", async () => {
    const dir = project(CONFIG, CASES);
    const o = io(dir);
    expect(await runCommand(["--quiet", "--report"], o)).toBe(0);
    const runId = fs.readdirSync(path.join(dir, ".hone", "runs"))[0]!;
    const html = fs.readFileSync(path.join(dir, "report.html"), "utf8");
    expect(html).toContain(runId);
    expect(html).toContain("greet");
    expect(o.out).toMatch(/wrote .*report\.html/);
    expect(await runCommand(["--quiet", "--report=second.html"], io(dir))).toBe(0);
    expect(fs.readFileSync(path.join(dir, "second.html"), "utf8")).toMatch(/<!doctype html>/);
  });

  test("--json prints a machine document and filters narrow the plan", async () => {
    const dir = project(CONFIG, CASES);
    const o = io(dir);
    const code = await runCommand(["--json", "--target", "up", "--tag", "smoke", "--trials", "1"], o);
    expect(code).toBe(0);
    const doc = JSON.parse(o.out) as { schemaVersion: number; runId: string; summary: { totals: { trials: number; passAt1: number } }; cells: { caseId: string; targetId: string }[]; trialIds: string[] };
    expect(doc.schemaVersion).toBe(1);
    expect(doc.cells).toEqual([{ caseId: "greet", targetId: "up" }].map((c) => expect.objectContaining(c)));
    expect(doc.summary.totals.trials).toBe(1);
    expect(doc.summary.totals.passAt1).toBe(1);
    expect(doc.trialIds).toHaveLength(1);
    const o2 = io(dir);
    await runCommand(["--json", path.join(dir, "out.json"), "--quiet"], o2);
    expect(fs.existsSync(path.join(dir, "out.json"))).toBe(true);
  });

  test("gates decide the exit code", async () => {
    const dir = project(CONFIG.replace("scorers:", "gates: { passAt1: { min: 0.9 } },\n  scorers:"), CASES);
    const o = io(dir);
    expect(await runCommand(["--quiet"], o)).toBe(1);
    expect(o.err).toMatch(/gate passAt1/);
    const ok = io(dir);
    expect(await runCommand(["--quiet", "--target", "up", "--case", "greet", "--case", "shout"], ok)).toBe(0);
  });

  test("--no-cache calls the target again; cache makes the second run free", async () => {
    const dir = project(CONFIG.replace("up: { kind: \"fn\", fn: (i) => String(i).toUpperCase() }", "up: { kind: \"fn\", fn: (i) => { globalThis.__calls = (globalThis.__calls ?? 0) + 1; return String(i).toUpperCase(); } }"), CASES);
    const g = globalThis as { __calls?: number };
    g.__calls = 0;
    await runCommand(["--quiet", "--target", "up", "--trials", "1"], io(dir));
    const first = g.__calls;
    await runCommand(["--quiet", "--target", "up", "--trials", "1"], io(dir));
    expect(g.__calls).toBe(first);
    await runCommand(["--quiet", "--target", "up", "--trials", "1", "--no-cache"], io(dir));
    expect(g.__calls).toBe(first! * 2);
  });

  test("missing config exits 2 with a hint; --help prints usage", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-run-empty-"));
    dirs.push(d);
    const o = io(d);
    expect(await runCommand([], o)).toBe(2);
    expect(o.err).toMatch(/hone init/);
    const h = io(d);
    expect(await runCommand(["--help"], h)).toBe(0);
    expect(h.out).toMatch(/--adaptive/);
  });
});
