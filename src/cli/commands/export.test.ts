import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { Trace, Trial } from "../../core/types";
import { exportCommand } from "./export";
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

function project(): { dir: string; runId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-export-"));
  dirs.push(dir);
  const store = new Store(path.join(dir, ".hone"));
  const run = store.createRun({ configHash: "h", targets: ["t"], caseIds: ["a", "b", "c"] });
  for (const [c, pass] of [["a", true], ["b", false], ["c", true]] as const) {
    const t: Trial = { id: Store.trialId(run.id, c, "t", 0), runId: run.id, trace: { ...base, id: c, caseId: c, targetId: "t" }, scores: [{ scorer: "exact", value: pass ? 1 : 0, pass }], flags: [], pass, costUsd: 0.001 };
    store.saveTrial(t);
  }
  store.finishRun(run.id, {});
  store.close();
  return { dir, runId: run.id };
}

describe("hone export rollouts", () => {
  test("writes JSONL for the latest run; --pass-only filters; prints the count", async () => {
    const { dir } = project();
    const o = io(dir);
    expect(await exportCommand(["rollouts", "--out", "r.jsonl"], o)).toBe(0);
    expect(fs.readFileSync(path.join(dir, "r.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
    expect(o.out).toMatch(/3 rollouts .*r\.jsonl/);
    const o2 = io(dir);
    expect(await exportCommand(["rollouts", "--out", "p.jsonl", "--pass-only", "--format", "openai", "--reward", "exact"], o2)).toBe(0);
    const lines = fs.readFileSync(path.join(dir, "p.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).messages).toBeDefined();
  });

  test("unknown format or run exits 2; other export kinds are not yet available", async () => {
    const { dir } = project();
    const o = io(dir);
    expect(await exportCommand(["rollouts", "--format", "parquet"], o)).toBe(2);
    expect(o.err).toMatch(/format/);
    const o2 = io(dir);
    expect(await exportCommand(["rollouts", "--run", "nope"], o2)).toBe(2);
    expect(o2.err).toMatch(/not found/);
    const o3 = io(dir);
    expect(await exportCommand(["otel"], o3)).toBe(2);
    expect(o3.err).toMatch(/not yet available/);
  });
});
