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
    expect(await exportCommand(["parquet"], o3)).toBe(2);
    expect(o3.err).toMatch(/export kind required/);
  });
});

describe("hone export otel|docent|junit|html", () => {
  test("each kind writes its default file for the latest run", async () => {
    const { dir, runId } = project();
    for (const [kind, file, probe] of [["otel", "otel.json", /"resourceSpans"/], ["docent", "docent.json", /"agent_runs"/], ["junit", "junit.xml", /<testsuite name="hone /], ["html", "report.html", /<!doctype html>/]] as const) {
      const o = io(dir);
      expect(await exportCommand([kind], o)).toBe(0);
      expect(o.out).toMatch(new RegExp(`wrote 3 trials as ${kind} to ${file}`));
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      expect(text).toMatch(probe);
      if (kind === "otel") expect(JSON.parse(text).resourceSpans[0].scopeSpans[0].spans.length).toBeGreaterThanOrEqual(3);
      if (kind === "junit") expect(text).toContain('tests="3" failures="1"');
      if (kind === "html") expect(text).toContain(runId);
    }
    const o = io(dir);
    expect(await exportCommand(["docent", "--out", "custom.json", "--run", runId], o)).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "custom.json"), "utf8")).agent_runs).toHaveLength(3);
  });
});
