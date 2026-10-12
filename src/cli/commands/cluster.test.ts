import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { Trace, Trial } from "../../core/types";
import type { JevQuestion, JevResult } from "../../providers/jev";
import { readTaxonomy } from "../../analysis/taxonomy";
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

  test("--induce names the clusters with the LLM, classifies every failure with Jev, saves the taxonomy", async () => {
    const { dir, runId } = project(6);
    const o = io(dir);
    const replies = [
      { code: "timeout-no-progress", axis: "system", definition: "Runs past the limit.", evidencePatterns: ["exit code 124"] },
      { code: "test-tampering", axis: "role", definition: "Skips tests.", evidencePatterns: ["skip-inserted"] },
    ];
    let i = 0;
    const chat = async (): Promise<{ text: string }> => ({ text: JSON.stringify(replies[i++ % 2]) });
    const jev = {
      ask: async (state: unknown, q: Record<string, JevQuestion>): Promise<JevResult> => {
        const pick = JSON.stringify(state).includes("timeout") ? "timeout-no-progress" : "test-tampering";
        expect(Object.keys((q.code as { criteria: Record<string, unknown> }).criteria)).toContain("other");
        return { answers: { code: { type: "choice", choice: pick, probabilities: { [pick]: 0.9 }, confidence: 0.9 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: "jev", costUsd: 0 };
      },
    };
    expect(await clusterCommand(["--k", "2", "--offline", "--induce"], o, { chat, jev })).toBe(0);
    const file = JSON.parse(fs.readFileSync(path.join(dir, ".hone", "analysis", `clusters-${runId}.json`), "utf8"));
    expect(file.codes.map((c: { code: string }) => c.code).sort()).toEqual(["test-tampering", "timeout-no-progress"]);
    for (const c of file.codes) expect(c.count).toBe(3);
    expect(readTaxonomy(path.join(dir, ".hone"))!.codes).toHaveLength(2);
    expect(o.out).toMatch(/timeout-no-progress/);
    expect(o.out).toMatch(/taxonomy\.json/);
  });

  test("--classify uses the saved taxonomy without inducing; fails without one", async () => {
    const { dir, runId } = project(4);
    const o = io(dir);
    expect(await clusterCommand(["--classify", "--offline"], o, { jev: { ask: async () => ({ answers: {}, usage: { input_tokens: 0, output_tokens: 0 }, model: "jev", costUsd: 0 }) } })).toBe(2);
    expect(o.err).toMatch(/no taxonomy/);
    fs.writeFileSync(path.join(dir, ".hone", "taxonomy.json"), JSON.stringify({ schemaVersion: 1, updatedAt: "2026-10-12T00:00:00Z", codes: [{ code: "only-code", axis: "system", definition: "d", evidencePatterns: [] }] }));
    let chats = 0;
    const chat = async (): Promise<{ text: string }> => {
      chats++;
      return { text: "{}" };
    };
    const jev = { ask: async (): Promise<JevResult> => ({ answers: { code: { type: "choice", choice: "other", probabilities: { other: 1 }, confidence: 1 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: "jev", costUsd: 0 }) };
    const o2 = io(dir);
    expect(await clusterCommand(["--classify", "--offline"], o2, { chat, jev })).toBe(0);
    expect(chats).toBe(0);
    const file = JSON.parse(fs.readFileSync(path.join(dir, ".hone", "analysis", `clusters-${runId}.json`), "utf8"));
    expect(file.codes.map((c: { code: string; count: number }) => [c.code, c.count])).toEqual([["only-code", 0], ["other", 4]]);
  });

  test("--induce reports an LLM failure as a clean error", async () => {
    const { dir } = project(2);
    const o = io(dir);
    const chat = async (): Promise<{ text: string }> => {
      throw new Error("llm: HTTP 400: bad request");
    };
    expect(await clusterCommand(["--offline", "--induce"], o, { chat })).toBe(1);
    expect(o.err).toMatch(/cluster failed: llm: HTTP 400/);
  });
});
