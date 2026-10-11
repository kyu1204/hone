import { afterEach, describe, expect, test } from "bun:test";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { act } from "react";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { ChatMessage, Trace, Trial } from "../../core/types";
import { App } from "../app";
import { createTuiStore, type TuiStore } from "../state";

const base = valid as Trace;
const dirs: string[] = [];
const stores: TuiStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const call = (name: string): ChatMessage => ({ role: "assistant", content: "", tool_calls: [{ id: name, type: "function", function: { name, arguments: "{}" } }] });
const result = (name: string, c: string): ChatMessage => ({ role: "tool", name, tool_call_id: name, content: c });

function fixture(): TuiStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-diff-"));
  dirs.push(root);
  const store = new Store(root);
  const run = store.createRun({ configHash: "h", targets: ["cc"], caseIds: ["fix-bug"] });
  const good: ChatMessage[] = [{ role: "user", content: "fix the bug" }, call("Read"), result("Read", "file"), call("Bash"), result("Bash", "1 pass"), { role: "assistant", content: "Fixed and verified." }];
  const bad: ChatMessage[] = [{ role: "user", content: "fix the bug" }, call("Read"), result("Read", "file"), { role: "assistant", content: "Fixed." }];
  const mk = (i: number, messages: ChatMessage[], pass: boolean): Trial => ({ id: Store.trialId(run.id, "fix-bug", "cc", i), runId: run.id, trace: { ...base, id: `t${i}`, caseId: "fix-bug", targetId: "cc", trial: i, messages, spans: [] }, scores: [], flags: [], pass, costUsd: 0.1 });
  store.saveTrial(mk(0, good, true));
  store.saveTrial(mk(1, bad, false));
  store.finishRun(run.id, {});
  store.close();
  const s = createTuiStore({ root });
  stores.push(s);
  return s;
}

describe("diff screen", () => {
  test("aligns two trials, names the divergence, jumps to it and swaps sides", async () => {
    const store = fixture();
    store.enter();
    store.nextTrial(1);
    store.setDiffWith({ caseId: "fix-bug", targetId: "cc", trialIdx: 0 });
    store.setScreen("diff");
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 120, height: 24 });
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("fix-bug_cc_0");
      expect(frame).toContain("fix-bug_cc_1");
      expect(frame).toMatch(/diverges at step 3/);
      expect(frame).toMatch(/Bash/);
      expect(frame).toMatch(/PASS/);
      expect(frame).toMatch(/FAIL/);
      await act(async () => {
        setup.mockInput.pressKey("n");
      });
      await setup.renderOnce();
      expect(store.getSnapshot().entryIdx).toBe(3);
      await act(async () => {
        setup.mockInput.pressKey(KeyCodes.TAB);
      });
      await setup.renderOnce();
      const swapped = setup.captureCharFrame();
      expect(swapped.indexOf("fix-bug_cc_1")).toBeLessThan(swapped.indexOf("fix-bug_cc_0"));
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

  test("without a second trial the screen explains how to pick one", async () => {
    const store = fixture();
    store.setScreen("diff");
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 80, height: 10 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toMatch(/press d/i);
    } finally {
      setup.renderer.destroy();
    }
  });
});
