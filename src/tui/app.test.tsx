import { afterEach, describe, expect, test } from "bun:test";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { act } from "react";
import valid from "../../test/fixtures/trace.valid.json";
import { Store } from "../core/store";
import type { Trace, Trial } from "../core/types";
import { App } from "./app";
import { createTuiStore, type TuiStore } from "./state";

const base = valid as Trace;
const dirs: string[] = [];
const stores: TuiStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(): TuiStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-app-"));
  dirs.push(root);
  const store = new Store(root);
  const run = store.createRun({ configHash: "h", targets: ["rag"], caseIds: ["alpha", "beta"] });
  for (const [caseId, pass] of [["alpha", true], ["beta", false]] as const) {
    const trial: Trial = { id: Store.trialId(run.id, caseId, "rag", 0), runId: run.id, trace: { ...base, id: caseId, caseId, targetId: "rag", trial: 0 }, scores: [{ scorer: "exact", value: pass ? 1 : 0, pass }], flags: [], pass, costUsd: 0.02 };
    store.saveTrial(trial);
  }
  store.finishRun(run.id, {});
  store.close();
  const s = createTuiStore({ root });
  stores.push(s);
  return s;
}

describe("App shell", () => {
  test("header shows the run, pass@1 and cost; help toggles; number keys switch screens; q quits", async () => {
    const store = fixture();
    let quit = 0;
    const setup = await testRender(<App store={store} onQuit={() => quit++} />, { width: 90, height: 24 });
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain(store.getSnapshot().runId!.slice(0, 10));
      expect(frame).toMatch(/pass@1 0\.50/);
      expect(frame).toMatch(/\$0\.04/);
      expect(frame).toContain("matrix");
      expect(frame).toContain("alpha");
      await act(async () => {
        setup.mockInput.pressKey("?");
      });
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toMatch(/keys/i);
      await act(async () => {
        setup.mockInput.pressKey("?");
        setup.mockInput.pressKey("4");
      });
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("clusters");
      await act(async () => {
        setup.mockInput.pressKey(KeyCodes.ESCAPE);
        // a lone ESC is only reported after the escape-sequence timeout
        await Bun.sleep(150);
      });
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("matrix");
      await act(async () => {
        setup.mockInput.pressKey("q");
      });
      expect(quit).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("empty store renders a hint instead of crashing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-app-empty-"));
    dirs.push(root);
    const store = createTuiStore({ root });
    stores.push(store);
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 60, height: 10 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toMatch(/hone test/);
    } finally {
      setup.renderer.destroy();
    }
  });
});
