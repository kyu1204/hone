import { describe, expect, test } from "bun:test";
import { bar, colorOn, decorateSharpen, paint } from "./paint";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("paint", () => {
  test("colors only on a terminal, and never with NO_COLOR; FORCE_COLOR turns them on anywhere", () => {
    expect(colorOn({}, true)).toBe(true);
    expect(colorOn({}, false)).toBe(false);
    expect(colorOn({ NO_COLOR: "1" }, true)).toBe(false);
    expect(colorOn({ FORCE_COLOR: "1" }, false)).toBe(true);
  });

  test("off, every style returns the text as it is", () => {
    const p = paint(false);
    expect(p.green("x") + p.bold("y") + p.badge("proven", "PROVEN")).toBe("xyPROVEN");
  });

  test("a bar shows a share in blocks", () => {
    expect(bar(0.5, 10)).toBe("█████░░░░░");
    expect(bar(1, 4)).toBe("████");
    expect(bar(0, 4)).toBe("░░░░");
  });

  const account = [
    "Now: 55% of 11 cases pass. 6 more cases are held out for the final check.",
    "Why it fails:",
    "  1. missing-required-phrase (4 of 6 failed trials, e.g. env-notice)",
    "     The answer leaves out the fixed notice.",
    "Tried 2 changes:",
    "  - loose matching   55% -> 45%",
    "  + rewrite 2        55% -> 91%   adds a final checklist",
    "Result: PROVEN. On 6 cases it never saw, rewrite 2 takes the pass rate from 67% to 100% (+33 points).",
    "",
  ].join("\n");

  test("the sharpen account keeps its words; on a terminal the verdict is a badge and the pass rates get bars", () => {
    expect(decorateSharpen(account, paint(false))).toBe(account);
    const on = decorateSharpen(account, paint(true));
    expect(on).toContain("\x1b[");
    expect(strip(on)).toContain(" PROVEN ");
    expect(strip(on)).toContain("Now: 55% ██████░░░░ of 11 cases pass.");
    expect(strip(on)).toContain("55% -> 91% █████████░");
    expect(strip(on)).toContain("Why it fails:");
  });
});
