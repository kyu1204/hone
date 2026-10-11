import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../test/fixtures/trace.valid.json";
import { Store } from "../core/store";
import type { Trace, Trial } from "../core/types";
import { createTuiStore, type TuiStore } from "./state";

const base = valid as Trace;
const dirs: string[] = [];
const stores: TuiStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

export function fixtureRun(): { root: string; runId: string; store: Store } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-tui-"));
  dirs.push(root);
  const store = new Store(root);
  const run = store.createRun({ configHash: "h", targets: ["rag", "cc"], caseIds: ["alpha", "beta"] });
  const outcomes: Record<string, boolean[]> = { "alpha:rag": [true, true], "alpha:cc": [true, false], "beta:rag": [false, false], "beta:cc": [true, true] };
  for (const [key, passes] of Object.entries(outcomes)) {
    const [caseId, targetId] = key.split(":") as [string, string];
    passes.forEach((pass, i) => {
      const trial: Trial = { id: Store.trialId(run.id, caseId, targetId, i), runId: run.id, trace: { ...base, id: `${key}-${i}`, caseId, targetId, trial: i }, scores: [{ scorer: "exact", value: pass ? 1 : 0, pass }], flags: i === 1 && caseId === "beta" && targetId === "rag" ? ["reward-hack"] : [], pass, costUsd: 0.01 };
      store.saveTrial(trial);
    });
  }
  store.finishRun(run.id, { totals: { passAt1: 0.625 } });
  return { root, runId: run.id, store };
}

describe("tui store", () => {
  test("loads the latest run into a grid snapshot", () => {
    const { root, runId } = fixtureRun();
    const s = createTuiStore({ root });
    stores.push(s);
    const snap = s.getSnapshot();
    expect(snap.runId).toBe(runId);
    expect(snap.cases).toEqual(["alpha", "beta"]);
    expect(snap.targets).toEqual(["rag", "cc"]);
    expect(snap.cells).toHaveLength(4);
    const betaRag = snap.cells.find((c) => c.caseId === "beta" && c.targetId === "rag")!;
    expect(betaRag.verdict.passAt1).toBe(0);
    expect(betaRag.trials.some((t) => t.flags.includes("reward-hack"))).toBe(true);
    expect(snap.passAt1).toBeCloseTo(5 / 8, 12);
    expect(snap.screen).toBe("matrix");
    expect(snap.selected).toEqual({ caseIdx: 0, targetIdx: 0 });
  });

  test("selection moves clamp and enter/back switch screens", () => {
    const { root } = fixtureRun();
    const s = createTuiStore({ root });
    stores.push(s);
    s.move(5, 5);
    expect(s.getSnapshot().selected).toEqual({ caseIdx: 1, targetIdx: 1 });
    s.move(-9, -9);
    expect(s.getSnapshot().selected).toEqual({ caseIdx: 0, targetIdx: 0 });
    s.enter();
    expect(s.getSnapshot().screen).toBe("trace");
    expect(s.getSnapshot().trialIdx).toBe(0);
    s.nextTrial(1);
    expect(s.getSnapshot().trialIdx).toBe(1);
    s.nextTrial(1);
    expect(s.getSnapshot().trialIdx).toBe(1);
    s.back();
    expect(s.getSnapshot().screen).toBe("matrix");
    s.setScreen("clusters");
    expect(s.getSnapshot().screen).toBe("clusters");
    s.toggleHelp();
    expect(s.getSnapshot().help).toBe(true);
  });

  test("subscribers are notified and reload picks up new trials; watch polls", async () => {
    const { root, runId, store } = fixtureRun();
    const s = createTuiStore({ root, watch: true, pollMs: 20 });
    stores.push(s);
    let notified = 0;
    const off = s.subscribe(() => notified++);
    const before = s.getSnapshot().cells.find((c) => c.caseId === "alpha" && c.targetId === "rag")!.trials.length;
    store.saveTrial({ id: Store.trialId(runId, "alpha", "rag", 2), runId, trace: { ...base, id: "x", caseId: "alpha", targetId: "rag", trial: 2 }, scores: [], flags: [], pass: true, costUsd: 0 });
    await Bun.sleep(80);
    const after = s.getSnapshot().cells.find((c) => c.caseId === "alpha" && c.targetId === "rag")!.trials.length;
    expect(after).toBe(before + 1);
    expect(notified).toBeGreaterThan(0);
    off();
    const snapBefore = s.getSnapshot();
    s.reload();
    expect(s.getSnapshot()).not.toBe(snapBefore);
  });

  test("an empty store yields an empty snapshot without throwing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-tui-empty-"));
    dirs.push(root);
    const s = createTuiStore({ root });
    stores.push(s);
    expect(s.getSnapshot().runId).toBeUndefined();
    expect(s.getSnapshot().cells).toEqual([]);
    s.move(1, 1);
    s.enter();
    expect(s.getSnapshot().screen).toBe("matrix");
  });
});
