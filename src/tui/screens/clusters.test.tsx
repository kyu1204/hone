import { afterEach, describe, expect, test } from "bun:test";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { act } from "react";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { Trace } from "../../core/types";
import { App } from "../app";
import { createTuiStore, type TuiStore } from "../state";
import { type ClustersFile, readClusters } from "./clusters";

const base = valid as Trace;
const dirs: string[] = [];
const stores: TuiStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(withClusters: boolean): { store: TuiStore; root: string; trialId: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-clusters-"));
  dirs.push(root);
  const store = new Store(root);
  const run = store.createRun({ configHash: "h", targets: ["rag"], caseIds: ["alpha", "beta"] });
  const trialId = Store.trialId(run.id, "beta", "rag", 0);
  store.saveTrial({ id: Store.trialId(run.id, "alpha", "rag", 0), runId: run.id, trace: { ...base, id: "a", caseId: "alpha", targetId: "rag", trial: 0 }, scores: [], flags: [], pass: true, costUsd: 0 });
  store.saveTrial({ id: trialId, runId: run.id, trace: { ...base, id: "b", caseId: "beta", targetId: "rag", trial: 0 }, scores: [], flags: [], pass: false, costUsd: 0 });
  store.finishRun(run.id, {});
  store.close();
  if (withClusters) {
    const file: ClustersFile = {
      schemaVersion: 1,
      runId: run.id,
      codes: [
        { code: "retrieval-miss", axis: "system", definition: "The right chunk was never retrieved.", evidencePatterns: ["no citation", "empty search"], count: 1, trialIds: [trialId] },
        { code: "premature-done", axis: "role", definition: "Claims completion without verification.", evidencePatterns: ["no test run"], count: 0, trialIds: [] },
      ],
    };
    fs.mkdirSync(path.join(root, "analysis"), { recursive: true });
    fs.writeFileSync(path.join(root, "analysis", `clusters-${run.id}.json`), JSON.stringify(file));
  }
  const s = createTuiStore({ root });
  stores.push(s);
  s.setScreen("clusters");
  return { store: s, root, trialId };
}

describe("clusters screen", () => {
  test("lists codes with counts, shows the definition and opens a trial", async () => {
    const { store, root, trialId } = fixture(true);
    expect(readClusters(root, store.getSnapshot().runId!)?.codes).toHaveLength(2);
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 100, height: 20 });
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("retrieval-miss");
      expect(frame).toContain("premature-done");
      expect(frame).toContain("never retrieved");
      expect(frame).toContain("no citation");
      expect(frame).toContain(trialId);
      await act(async () => {
        setup.mockInput.pressKey(KeyCodes.RETURN);
      });
      await setup.renderOnce();
      expect(store.getSnapshot().screen).toBe("trace");
      expect(store.selectedTrial()?.id).toBe(trialId);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("without a clusters file the screen points to hone cluster", async () => {
    const { store } = fixture(false);
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 80, height: 10 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("hone cluster");
    } finally {
      setup.renderer.destroy();
    }
  });
});
