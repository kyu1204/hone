import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../../core/store";
import { importCommand } from "./import";
import type { CommandIo } from "./run";

const fixture = new URL("../../../test/fixtures/claude-code-session.jsonl", import.meta.url).pathname;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function io(cwd: string, env: Record<string, string | undefined> = {}): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}

describe("hone import claude-code", () => {
  test("imports session files into a run, writes cases JSONL, prints a table", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-import-"));
    dirs.push(dir);
    const o = io(dir);
    expect(await importCommand(["claude-code", fixture, "--cases", "cases.jsonl"], o)).toBe(0);
    expect(o.out).toMatch(/abcdef12\s+feat\/x\s+2\s+Read, Edit, Write, Bash/);
    expect(o.out).toMatch(/\$0\.4200/);
    expect(o.out).toMatch(/Fix the flaky test/);
    expect(o.out).toMatch(/imported 1 session/);
    const store = new Store(path.join(dir, ".hone"));
    const run = store.listRuns(1)[0]!;
    expect(run.targets).toEqual(["claude-code"]);
    expect(run.summary).toMatchObject({ imported: "claude-code" });
    const trials = store.queryTrials({ runId: run.id });
    store.close();
    expect(trials).toHaveLength(1);
    expect(trials[0]!.runId).toBe(run.id);
    expect(trials[0]!.id).toContain(run.id);
    expect(trials[0]!.trace.messages.length).toBeGreaterThan(5);
    const cases = fs.readFileSync(path.join(dir, "cases.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id: string; input: string });
    expect(cases).toEqual([expect.objectContaining({ id: "abcdef12", input: "Fix the flaky test in auth" })]);
  });

  test("defaults to ~/.claude/projects/<dashed cwd>; --json prints the result; nothing found exits 1", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "hone-import-home-"));
    dirs.push(home);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hone-import-cwd-"));
    dirs.push(cwd);
    const projects = path.join(home, ".claude", "projects", cwd.replace(/[^A-Za-z0-9-]/g, "-"));
    fs.mkdirSync(projects, { recursive: true });
    fs.copyFileSync(fixture, path.join(projects, "s1.jsonl"));
    const o = io(cwd, { HOME: home });
    expect(await importCommand(["claude-code", "--json"], o)).toBe(0);
    const j = JSON.parse(o.out) as { runId: string; cases: { id: string }[]; skipped: number };
    expect(j.cases.map((c) => c.id)).toEqual(["abcdef12"]);
    expect(j.runId).toBeTruthy();
    const o2 = io(cwd, { HOME: home });
    expect(await importCommand(["claude-code", "--project", path.join(cwd, "nowhere")], o2)).toBe(1);
    expect(o2.err).toMatch(/no sessions/);
  });

  test("unknown kind exits 2; other kinds are not yet available", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-import2-"));
    dirs.push(dir);
    const o = io(dir);
    expect(await importCommand(["bogus"], o)).toBe(2);
    expect(o.err).toMatch(/import kind/);
    const o2 = io(dir);
    expect(await importCommand(["inspect", "x.json"], o2)).toBe(2);
    expect(o2.err).toMatch(/not yet available/);
  });
});
