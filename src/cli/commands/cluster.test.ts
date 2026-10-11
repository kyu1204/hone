import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { Trace, Trial } from "../../core/types";
import { clusterCommand } from "./cluster";
import type { CommandIo } from "./run";

const base = valid as Trace;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function io(cwd: string): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env: {}, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}

function project(failures: number): { dir: string; runId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-cluster-"));
  dirs.push(dir);
  const store = new Store(path.join(dir, ".hone"));
  const run = store.createRun({ configHash: "h", targets: ["agent"], caseIds: [] });
  for (let i = 0; i < failures; i++) {
    const mode = i % 2 === 0 ? "timeout" : "tamper";
    const t: Trial = {
      id: Store.trialId(run.id, `case-${i}`, "agent", 0),
      runId: run.id,
      trace: { ...base, id: `t${i}`, caseId: `case-${i}`, error: mode === "timeout" ? "timeout after 600s" : undefined, output: mode === "timeout" ? "" : "marked the failing test skipped" },
      scores: [{ scorer: mode === "timeout" ? "test_command" : "hack", value: 0, pass: false, reason: mode === "timeout" ? "exit code 124 after timeout" : "tampering signals: skip-inserted" }],
      flags: [mode === "timeout" ? "timeout" : "reward-hack"],
      pass: false,
      costUsd: 0.01,
    };
    store.saveTrial(t);
  }
  store.saveTrial({ id: Store.trialId(run.id, "ok", "agent", 0), runId: run.id, trace: { ...base, id: "ok", caseId: "ok" }, scores: [], flags: [], pass: true, costUsd: 0.01 });
  store.finishRun(run.id, {});
  store.close();
  return { dir, runId: run.id };
}

describe("hone cluster", () => {
  test("writes clusters-<runId>.json in the TUI shape and prints a table", async () => {
    const { dir, runId } = project(6);
    const o = io(dir);
    expect(await clusterCommand(["--k", "2", "--offline"], o)).toBe(0);
    const file = JSON.parse(fs.readFileSync(path.join(dir, ".hone", "analysis", `clusters-${runId}.json`), "utf8"));
    expect(file.schemaVersion).toBe(1);
    expect(file.runId).toBe(runId);
    expect(file.codes).toHaveLength(2);
    for (const c of file.codes) {
      expect(c).toMatchObject({ axis: "system" });
      expect(c.code).toMatch(/^cluster-\d$/);
      expect(c.count).toBe(c.trialIds.length);
      expect(c.definition.length).toBeGreaterThan(0);
      expect(c.evidencePatterns.length).toBeGreaterThan(0);
    }
    expect(file.codes.reduce((s: number, c: { count: number }) => s + c.count, 0)).toBe(6);
    expect(o.out).toMatch(/cluster-1/);
    expect(o.out).toMatch(/6 failed trials.*2 clusters/);
    expect(o.out).toMatch(/method hash/);
  });

  test("--json prints the file; a run without failures writes nothing and says so", async () => {
    const { dir, runId } = project(2);
    const o = io(dir);
    expect(await clusterCommand(["--json", "--offline", "--run", runId], o)).toBe(0);
    expect(JSON.parse(o.out).runId).toBe(runId);
    const clean = project(0);
    const o2 = io(clean.dir);
    expect(await clusterCommand(["--offline"], o2)).toBe(0);
    expect(o2.out).toMatch(/no failed trials/);
    expect(fs.existsSync(path.join(clean.dir, ".hone", "analysis", `clusters-${clean.runId}.json`))).toBe(false);
  });

  test("unknown run exits 2", async () => {
    const { dir } = project(1);
    const o = io(dir);
    expect(await clusterCommand(["--run", "nope", "--offline"], o)).toBe(2);
    expect(o.err).toMatch(/not found/);
  });
});
