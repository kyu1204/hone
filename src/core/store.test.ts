import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../test/fixtures/trace.valid.json";
import { Store } from "./store";
import type { Trace, Trial } from "./types";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-store-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function trial(runId: string, caseId: string, targetId: string, n: number, pass: boolean | null): Trial {
  const trace: Trace = { ...(valid as Trace), id: `${runId}-${caseId}-${targetId}-${n}`, caseId, targetId, trial: n };
  return {
    id: Store.trialId(runId, caseId, targetId, n),
    runId,
    trace,
    scores: [{ scorer: "exact", value: pass ? 1 : 0, pass }],
    flags: n === 1 ? ["cached"] : [],
    pass,
    costUsd: 0.001 * (n + 1),
  };
}

describe("Store", () => {
  test("creates runs with sortable ids and lists newest first", async () => {
    const s = new Store(tmp());
    const a = s.createRun({ configHash: "h", targets: ["rag"], caseIds: ["c1"] });
    await Bun.sleep(5);
    const b = s.createRun({ configHash: "h", targets: ["rag"], caseIds: ["c1"] });
    expect(a.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    expect(s.listRuns().map((r) => r.id)).toEqual([b.id, a.id]);
    expect(s.getRun(a.id)?.configHash).toBe("h");
    expect(s.getRun("missing")).toBeUndefined();
  });

  test("saves trials as json files and queries through the index", () => {
    const root = tmp();
    const s = new Store(root);
    const run = s.createRun({ configHash: "h", targets: ["rag", "cc"], caseIds: ["c1", "c2"] });
    s.saveTrial(trial(run.id, "c1", "rag", 0, true));
    s.saveTrial(trial(run.id, "c1", "rag", 1, false));
    s.saveTrial(trial(run.id, "c2", "cc", 0, null));

    expect(fs.readdirSync(path.join(root, "runs", run.id, "trials"))).toHaveLength(3);
    expect(s.queryTrials({ runId: run.id })).toHaveLength(3);
    expect(s.queryTrials({ caseId: "c1", targetId: "rag" }).map((t) => t.trace.trial)).toEqual([0, 1]);
    expect(s.queryTrials({ runId: run.id, pass: true })).toHaveLength(1);
    expect(s.queryTrials({ runId: run.id, pass: null })).toHaveLength(1);
    const t = s.getTrial(Store.trialId(run.id, "c1", "rag", 1));
    expect(t?.flags).toEqual(["cached"]);
    expect(t?.id).not.toContain("/");
  });

  test("finishRun stores a summary", () => {
    const s = new Store(tmp());
    const run = s.createRun({ configHash: "h", targets: [], caseIds: [] });
    s.finishRun(run.id, { passAt1: 0.5 });
    expect(s.getRun(run.id)?.summary).toEqual({ passAt1: 0.5 });
  });

  test("the sqlite index is rebuilt from json when missing", () => {
    const root = tmp();
    const s1 = new Store(root);
    const run = s1.createRun({ configHash: "h", targets: ["rag"], caseIds: ["c1"] });
    s1.saveTrial(trial(run.id, "c1", "rag", 0, true));
    s1.close();
    fs.rmSync(path.join(root, "index.sqlite"), { force: true });

    const s2 = new Store(root);
    expect(s2.listRuns()).toHaveLength(1);
    expect(s2.queryTrials({ runId: run.id })).toHaveLength(1);
    s2.rebuildIndex();
    expect(s2.queryTrials({ caseId: "c1" })).toHaveLength(1);
  });
});
