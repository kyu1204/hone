import { afterEach, describe, expect, test } from "bun:test";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { act } from "react";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { ChatMessage, Trace } from "../../core/types";
import { createTargets } from "../../targets/index";
import type { FnContext } from "../../targets/fn";
import { App } from "../app";
import { createTuiStore, type TuiStore } from "../state";

const base = valid as Trace;
const dirs: string[] = [];
const stores: TuiStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(): TuiStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-forkscreen-"));
  dirs.push(root);
  const store = new Store(root);
  const run = store.createRun({ configHash: "h", targets: ["t"], caseIds: ["c"] });
  const messages: ChatMessage[] = [{ role: "user", content: "question" }, { role: "tool", tool_call_id: "x", name: "search", content: "wrong document" }, { role: "assistant", content: "wrong answer" }];
  store.saveTrial({ id: Store.trialId(run.id, "c", "t", 0), runId: run.id, trace: { ...base, id: "o", caseId: "c", targetId: "t", trial: 0, messages }, scores: [{ scorer: "contains", value: 0, pass: false, reason: "missing" }], flags: [], pass: false, costUsd: 0.1 });
  store.finishRun(run.id, {});
  store.close();
  const targets = createTargets({ t: { kind: "fn", fn: (_i: unknown, ctx: FnContext) => `answer from ${String(ctx.prefix?.at(-1)?.content)}` } });
  const s = createTuiStore({ root, fork: { targets, scorers: [{ name: "contains", text: "right document" }], caseInputs: { c: "question" } } });
  stores.push(s);
  s.enter();
  s.setScreen("fork");
  return s;
}

describe("fork screen", () => {
  test("lists steps, edits one, runs the fork and shows the new verdict", async () => {
    const store = fixture();
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 110, height: 22 });
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("fork");
      expect(frame).toContain("wrong document");
      await act(async () => {
        setup.mockInput.pressKey("j");
        setup.mockInput.pressKey(KeyCodes.RETURN);
      });
      await setup.renderOnce();
      expect(store.getSnapshot().inputActive).toBe(true);
      await act(async () => {
        await setup.mockInput.typeText(" but right document");
        setup.mockInput.pressKey(KeyCodes.RETURN);
      });
      await setup.renderOnce();
      expect(store.getSnapshot().forkEdit?.content).toContain("right document");
      await act(async () => {
        setup.mockInput.pressKey("r");
        await Bun.sleep(50);
      });
      await setup.renderOnce();
      const after = setup.captureCharFrame();
      expect(after).toMatch(/forked.*PASS|PASS/);
      const forked = store.getSnapshot().forkResult;
      expect(forked?.pass).toBe(true);
      expect(forked?.flags.some((f) => f.startsWith("forked-from:"))).toBe(true);
      await act(async () => {
        setup.mockInput.pressKey("d");
      });
      await setup.renderOnce();
      expect(store.getSnapshot().screen).toBe("diff");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("read-only mode refuses to run", async () => {
    const store = fixture();
    const ro = createTuiStore({ root: store.getSnapshot().root, readOnly: true });
    stores.push(ro);
    ro.enter();
    ro.setScreen("fork");
    const setup = await testRender(<App store={ro} onQuit={() => {}} />, { width: 100, height: 14 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toMatch(/read-only/);
    } finally {
      setup.renderer.destroy();
    }
  });
});
