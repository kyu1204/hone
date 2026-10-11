import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { Trace, Trial } from "../../core/types";
import { compareCommand } from "./compare";
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

/** A project with a store containing one run where target `a` passes a pattern and `b` another. */
function project(outcomes: Record<string, (caseIdx: number, trial: number) => boolean>, nCases = 12, trials = 2, cluster = false): { dir: string; runId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-cmp-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "hone.config.ts"), "export default { targets: {}, cases: [], scorers: [] };\n");
  const store = new Store(path.join(dir, ".hone"));
  const run = store.createRun({ configHash: "h", targets: Object.keys(outcomes), caseIds: [] });
  for (const [targetId, fn] of Object.entries(outcomes)) {
    for (let c = 0; c < nCases; c++) {
      for (let t = 0; t < trials; t++) {
        const pass = fn(c, t);
        const trace: Trace = { ...base, id: `${targetId}-${c}-${t}`, caseId: `case${c}`, targetId, trial: t, ...(cluster ? { meta: { cluster: `doc${c % 3}` } } : {}) };
        const trial: Trial = { id: Store.trialId(run.id, `case${c}`, targetId, t), runId: run.id, trace, scores: [{ scorer: "exact", value: pass ? 1 : 0, pass }], flags: [], pass, costUsd: 0.001 };
        store.saveTrial(trial);
      }
    }
  }
  store.finishRun(run.id, {});
  store.close();
  return { dir, runId: run.id };
}

describe("hone compare", () => {
  test("a clear winner is reported with paired statistics", async () => {
    const { dir } = project({ a: () => true, b: (c) => c % 4 === 0 });
    const o = io(dir);
    expect(await compareCommand(["a", "b"], o)).toBe(0);
    expect(o.out).toMatch(/a better/);
    expect(o.out).toMatch(/difference/i);
    expect(o.out).toMatch(/McNemar/);
    expect(o.out).toMatch(/p[ =<]/);
  });

  test("noise gives no significant difference; json carries rows and the result", async () => {
    const { dir } = project({ a: (c) => c % 2 === 0, b: (c) => c % 2 === 1 || c === 0 });
    const o = io(dir);
    await compareCommand(["a", "b", "--json"], o);
    const doc = JSON.parse(o.out) as { verdict: string; rows: unknown[]; result: { paired: { n: number } }; missing: number };
    expect(doc.rows).toHaveLength(12);
    expect(doc.result.paired.n).toBe(12);
    expect(doc.missing).toBe(0);
    const t = io(dir);
    await compareCommand(["a", "b"], t);
    expect(t.out).toMatch(/no significant difference/);
  });

  test("cases missing on one side are dropped and counted; clusters add a robust interval", async () => {
    const { dir } = project({ a: () => true, b: () => false }, 6, 1, true);
    const store = new Store(path.join(dir, ".hone"));
    const run = store.listRuns()[0]!;
    const extra: Trial = { id: Store.trialId(run.id, "only-a", "a", 0), runId: run.id, trace: { ...base, id: "x", caseId: "only-a", targetId: "a", trial: 0 }, scores: [], flags: [], pass: true, costUsd: 0 };
    store.saveTrial(extra);
    store.close();
    const o = io(dir);
    await compareCommand(["a", "b", "--json"], o);
    const doc = JSON.parse(o.out) as { missing: number; result: { clustered?: { nClusters: number } } };
    expect(doc.missing).toBe(1);
    expect(doc.result.clustered?.nClusters).toBe(3);
  });

  test("unknown target or run is a usage error", async () => {
    const { dir } = project({ a: () => true, b: () => true }, 3, 1);
    const o = io(dir);
    expect(await compareCommand(["a", "zzz"], o)).toBe(2);
    expect(o.err).toMatch(/zzz/);
    expect(await compareCommand(["a"], io(dir))).toBe(2);
  });
});
