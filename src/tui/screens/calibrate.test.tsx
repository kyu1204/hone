import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { App } from "../app";
import { createTuiStore, type TuiStore } from "../state";
import { type CalibrationFile, readCalibrations } from "./calibrate";

const dirs: string[] = [];
const stores: TuiStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fixture(files: CalibrationFile[]): { store: TuiStore; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-calibrate-"));
  dirs.push(root);
  fs.mkdirSync(path.join(root, "analysis"), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(root, "analysis", `calibration-${f.judge}.json`), JSON.stringify(f));
  const s = createTuiStore({ root });
  stores.push(s);
  s.setScreen("calibrate");
  return { store: s, root };
}

describe("calibrate screen", () => {
  test("shows detection rates with interval bars, false alarms and kappa per judge", async () => {
    const { store, root } = fixture([
      { schemaVersion: 1, judge: "jev-steps", domain: "agent", faults: [{ type: "verification-removed", injected: 20, detected: 14, rate: 0.7, lo: 0.48, hi: 0.86 }, { type: "tool-result-swapped", injected: 20, detected: 6, rate: 0.3, lo: 0.15, hi: 0.52 }], falseAlarms: { n: 20, flagged: 1, rate: 0.05 }, kappa: 0.62 },
    ]);
    expect(readCalibrations(root)).toHaveLength(1);
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 100, height: 16 });
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("jev-steps");
      expect(frame).toContain("verification-removed");
      expect(frame).toMatch(/0\.70/);
      expect(frame).toMatch(/\[0\.48, 0\.86\]/);
      expect(frame).toMatch(/false alarms.*0\.05/);
      expect(frame).toMatch(/kappa.*0\.62/);
      expect(frame).toMatch(/[█▓▒░#=]{3,}/);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("empty state", async () => {
    const { store } = fixture([]);
    const setup = await testRender(<App store={store} onQuit={() => {}} />, { width: 80, height: 8 });
    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("hone calibrate");
    } finally {
      setup.renderer.destroy();
    }
  });
});
