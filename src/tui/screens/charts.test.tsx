import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { Trace } from "../../core/types";
import { App } from "../app";
import { createTuiStore, type TuiStore } from "../state";
import { chartData } from "./charts";

const base = valid as Trace;
const dirs: string[] = [];
const stores: TuiStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function fixture(): Promise<{ store: TuiStore; root: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-charts-"));
  dirs.push(root);
  const store = new Store(root);
  // cheap passes floor(5 * rate) cases, pricey one more: 0.5, 0.7, 0.9 overall
  const rates = [0.4, 0.6, 0.8];
  for (const rate of rates) {
    await Bun.sleep(3); // distinct createdAt timestamps
    const run = store.createRun({ configHash: "same", targets: ["cheap", "pricey"], caseIds: ["a", "b", "c", "d", "e"] });
    for (const targetId of ["cheap", "pricey"]) {
      for (let c = 0; c < 5; c++) {
        const pass = targetId === "pricey" ? c < 5 * rate + 1 : c < 5 * rate;
        store.saveTrial({ id: Store.trialId(run.id, `c${c}`, targetId, 0), runId: run.id, trace: { ...base, id: `${run.id}-${targetId}-${c}`, caseId: `c${c}`, targetId, trial: 0, usage: { inputTokens: 10, outputTokens: 1, costUsd: targetId === "pricey" ? 0.2 : 0.02 } }, scores: [], flags: [], pass, costUsd: targetId === "pricey" ? 0.2 : 0.02 });
      }
    }
    store.finishRun(run.id, {});
  }
  store.close();
  const s = createTuiStore({ root });
  stores.push(s);
  s.setScreen("charts");
  return { store: s, root };
}

describe("charts", () => {
  test("chartData gathers run history, pareto points and interval bars", async () => {
    const { root, store } = await fixture();
    const data = chartData(root, store.getSnapshot().run!);
    expect(data.history).toHaveLength(3);
    const rates = data.history.map((h) => h.passAt1);
    expect(rates[0]!).toBeLessThan(rates[1]!);
    expect(rates[1]!).toBeLessThan(rates[2]!);
    expect(data.pareto).toHaveLength(2);
    const cheap = data.pareto.find((p) => p.id === "cheap")!;
    // five trials at $0.02 over four solves
    expect(cheap.costPerSolve).toBeCloseTo(0.1 / 4, 9);
    expect(data.intervals.find((i) => i.id === "pricey")!.hi).toBeGreaterThan(0.8);
  });

  test("the screen renders the three sections", async () => {
    const { store } = await fixture();
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 100, height: 24 });
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toMatch(/pass@1 over runs/);
      expect(frame).toMatch(/[▁▂▃▄▅▆▇█]{3}/);
      expect(frame).toMatch(/cost vs pass@1/);
      expect(frame).toContain("cheap");
      expect(frame).toContain("pricey");
      expect(frame).toMatch(/intervals/);
      expect(frame).toMatch(/[▒█]{3,}/);
    } finally {
      setup.renderer.destroy();
    }
  });
});
