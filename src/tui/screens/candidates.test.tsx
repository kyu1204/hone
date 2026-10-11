import { afterEach, describe, expect, test } from "bun:test";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { act } from "react";
import { App } from "../app";
import { createTuiStore, type TuiStore } from "../state";
import { type CandidatesFile, readCandidates, textDiff } from "./candidates";

const dirs: string[] = [];
const stores: TuiStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(file?: CandidatesFile): { store: TuiStore; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-candidates-"));
  dirs.push(root);
  if (file) {
    fs.mkdirSync(path.join(root, "evolve"), { recursive: true });
    fs.writeFileSync(path.join(root, "evolve", "e1.json"), JSON.stringify(file));
  }
  const s = createTuiStore({ root });
  stores.push(s);
  s.setScreen("candidates");
  return { store: s, root };
}

describe("textDiff", () => {
  test("marks removed and added lines", () => {
    const d = textDiff("a\nb\nc", "a\nB\nc\nd");
    expect(d).toEqual(["  a", "- b", "+ B", "  c", "+ d"]);
  });
});

describe("candidates screen", () => {
  test("lists candidates with pass rate, interval, cost and Pareto marker; enter shows the diff", async () => {
    const { store, root } = fixture({
      schemaVersion: 1,
      kind: "evolve",
      baseline: { id: "base", text: "You are a helpful assistant.\nAnswer briefly.", passAt1: 0.6, lo: 0.4, hi: 0.78, costUsd: 0.1, pareto: false },
      candidates: [
        { id: "c1", text: "You are a helpful assistant.\nAnswer briefly and cite sources.", passAt1: 0.85, lo: 0.66, hi: 0.95, costUsd: 0.12, pareto: true },
        { id: "c2", text: "You are an assistant.\nAnswer briefly.", passAt1: 0.55, lo: 0.35, hi: 0.73, costUsd: 0.08, pareto: true },
      ],
    });
    expect(readCandidates(root)?.candidates).toHaveLength(2);
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 110, height: 20 });
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("c1");
      expect(frame).toMatch(/0\.85/);
      expect(frame).toMatch(/\[0\.66, 0\.95\]/);
      expect(frame).toMatch(/\$0\.12/);
      expect(frame).toMatch(/pareto|★/i);
      await act(async () => {
        setup.mockInput.pressKey(KeyCodes.RETURN);
      });
      await setup.renderOnce();
      const diff = setup.captureCharFrame();
      expect(diff).toContain("+ Answer briefly and cite sources.");
      expect(diff).toContain("- Answer briefly.");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("empty state", async () => {
    const { store } = fixture();
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 80, height: 8 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toMatch(/hone evolve|hone optimize/);
    } finally {
      setup.renderer.destroy();
    }
  });
});
