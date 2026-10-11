import { afterEach, describe, expect, test } from "bun:test";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { act } from "react";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { Trace, Trial } from "../../core/types";
import { App } from "../app";
import { createTuiStore, type TuiStore } from "../state";
import { traceEntries } from "./trace";

const base = valid as Trace;
const dirs: string[] = [];
const stores: TuiStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(): { store: TuiStore; trial: Trial } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-trace-"));
  dirs.push(root);
  const store = new Store(root);
  const run = store.createRun({ configHash: "h", targets: ["rag"], caseIds: ["citations-basic"] });
  const trial: Trial = {
    id: Store.trialId(run.id, "citations-basic", "rag", 0),
    runId: run.id,
    trace: { ...base, meta: { model: "stub-model" } },
    scores: [
      { scorer: "exact", value: 1, pass: true, reason: "output equals expected" },
      { scorer: "rag.citations", value: 0.5, pass: false, reason: "1/2 citations resolve", evidence: [{ unresolved: ["c9"], markers: ["c1", "c9"] }] },
    ],
    flags: ["reward-hack"],
    pass: false,
    costUsd: 0.0123,
  };
  store.saveTrial(trial);
  store.saveTrial({ ...trial, id: Store.trialId(run.id, "citations-basic", "rag", 1), trace: { ...trial.trace, id: "second", trial: 1, output: "second answer" }, pass: true, flags: [] });
  store.finishRun(run.id, {});
  store.close();
  const s = createTuiStore({ root });
  stores.push(s);
  s.enter();
  return { store: s, trial };
}

describe("traceEntries", () => {
  test("scores first, then messages, then spans, each with a one-line summary and detail", () => {
    const { trial } = fixture();
    const entries = traceEntries(trial);
    expect(entries[0]).toMatchObject({ kind: "score", summary: expect.stringContaining("exact") });
    expect(entries.find((e) => e.kind === "message" && /tool_calls|search\(/.test(e.summary))).toBeDefined();
    const toolMsg = entries.find((e) => e.kind === "message" && e.summary.startsWith("tool"));
    expect(toolMsg?.detail).toContain("The policy starts on 2026-07-01");
    expect(entries.some((e) => e.kind === "span" && e.summary.includes("retrieval search"))).toBe(true);
    const retrieval = entries.find((e) => e.kind === "span" && e.summary.includes("retrieval"));
    expect(retrieval?.context).toContain("c1");
  });
});

describe("trace screen", () => {
  test("shows header, scores, moves entries, expands, searches and switches trials", async () => {
    const { store } = fixture();
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 110, height: 28 });
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("citations-basic");
      expect(frame).toMatch(/FAIL/);
      expect(frame).toContain("reward-hack");
      expect(frame).toContain("stub-model");
      expect(frame).toContain("rag.citations");
      expect(frame).toContain("#0 of 2");
      await act(async () => {
        setup.mockInput.pressKey("j");
      });
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("c9");
      await act(async () => {
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey(KeyCodes.RETURN);
      });
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toMatch(/new policy start|search/);
      await act(async () => {
        setup.mockInput.pressKey("]");
      });
      await setup.renderOnce();
      const second = setup.captureCharFrame();
      expect(second).toContain("#1 of 2");
      expect(second).toMatch(/PASS/);
      await act(async () => {
        setup.mockInput.pressKey("/");
      });
      await setup.renderOnce();
      await act(async () => {
        await setup.mockInput.typeText("second");
        setup.mockInput.pressKey(KeyCodes.RETURN);
      });
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toMatch(/1 match|match/);
      await act(async () => {
        setup.mockInput.pressKey(KeyCodes.ESCAPE);
        await Bun.sleep(150);
      });
      await setup.renderOnce();
      expect(store.getSnapshot().screen).toBe("matrix");
    } finally {
      setup.renderer.destroy();
    }
  });
});
