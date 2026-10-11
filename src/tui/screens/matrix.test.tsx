import { afterEach, describe, expect, test } from "bun:test";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { act } from "react";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { Trace, Trial, TrialFlag } from "../../core/types";
import { App } from "../app";
import { createTuiStore, type TuiStore } from "../state";
import { cellLabel } from "./matrix";

const base = valid as Trace;
const dirs: string[] = [];
const stores: TuiStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(): TuiStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-matrix-"));
  dirs.push(root);
  const store = new Store(root);
  const run = store.createRun({ configHash: "h", targets: ["rag", "cc"], caseIds: ["alpha", "beta", "gamma"] });
  const spec: Record<string, { passes: boolean[]; flags?: TrialFlag[]; tags?: string[] }> = {
    "alpha:rag": { passes: [true, true, true] },
    "alpha:cc": { passes: [true, false, true] },
    "beta:rag": { passes: [false, false, false], flags: ["reward-hack"] },
    "beta:cc": { passes: [true, true, true] },
    "gamma:rag": { passes: [true, true, true, true, true, true, true] },
    "gamma:cc": { passes: [false, true, true], flags: ["timeout"] },
  };
  for (const [key, s] of Object.entries(spec)) {
    const [caseId, targetId] = key.split(":") as [string, string];
    s.passes.forEach((pass, i) => {
      store.saveTrial({ id: Store.trialId(run.id, caseId, targetId, i), runId: run.id, trace: { ...base, id: `${key}-${i}`, caseId, targetId, trial: i }, scores: [], flags: i === 0 ? (s.flags ?? []) : [], pass, costUsd: 0.01 * (targetId === "cc" ? 2 : 1) });
    });
  }
  store.finishRun(run.id, {});
  store.close();
  const s = createTuiStore({ root });
  stores.push(s);
  return s;
}

describe("cellLabel", () => {
  test("dots, pass rate and flag markers; more than five trials get a plus", () => {
    const trials = (passes: boolean[], flags: TrialFlag[] = []): Trial[] => passes.map((pass, i) => ({ id: String(i), runId: "r", trace: { ...base, trial: i }, scores: [], flags: i === 0 ? flags : [], pass, costUsd: 0 }));
    expect(cellLabel(trials([true, false, true]))).toBe("●○● 0.67");
    expect(cellLabel(trials([true, true, true, true, true, true]))).toBe("●●●●●+ 1.00");
    expect(cellLabel(trials([false], ["reward-hack"]))).toBe("○ 0.00 ⚑");
    expect(cellLabel(trials([true], ["timeout"]))).toBe("● 1.00 ⏱");
    expect(cellLabel([])).toBe("·");
  });
});

describe("matrix screen", () => {
  test("renders the grid with headers, moves the selection, opens a trial and shows the summary row", async () => {
    const store = fixture();
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 100, height: 20 });
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toMatch(/case.*rag.*cc/);
      expect(frame).toContain("alpha");
      expect(frame).toContain("●●● 1.00");
      expect(frame).toContain("●○● 0.67");
      expect(frame).toContain("⚑");
      await act(async () => {
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("l");
      });
      await setup.renderOnce();
      expect(store.getSnapshot().selected).toEqual({ caseIdx: 1, targetIdx: 1 });
      await act(async () => {
        setup.mockInput.pressKey("c");
      });
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toMatch(/pass@1/);
      await act(async () => {
        setup.mockInput.pressKey(KeyCodes.RETURN);
      });
      await setup.renderOnce();
      expect(store.getSnapshot().screen).toBe("trace");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("sort cycles and the filter narrows rows", async () => {
    const store = fixture();
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 100, height: 20 });
    try {
      await setup.renderOnce();
      const order = (frame: string) => ["alpha", "beta", "gamma"].sort((a, b) => frame.indexOf(a) - frame.indexOf(b));
      expect(order(setup.captureCharFrame())).toEqual(["alpha", "beta", "gamma"]);
      await act(async () => {
        setup.mockInput.pressKey("s");
      });
      await setup.renderOnce();
      expect(order(setup.captureCharFrame())[0]).toBe("beta");
      await act(async () => {
        setup.mockInput.pressKey("/");
      });
      await setup.renderOnce();
      await act(async () => {
        await setup.mockInput.typeText("gam");
        setup.mockInput.pressKey(KeyCodes.RETURN);
      });
      await setup.renderOnce();
      const filtered = setup.captureCharFrame();
      expect(filtered).toContain("gamma");
      expect(filtered).not.toContain("alpha");
    } finally {
      setup.renderer.destroy();
    }
  });
});
