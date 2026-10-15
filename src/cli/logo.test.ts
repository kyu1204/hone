import { describe, expect, test } from "bun:test";
import { logoFrames, showLogo } from "./logo";

const strip = (s: string) => s.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[mA-Zlh]`, "g"), "");

describe("logo", () => {
  test("the block letters of hone appear column by column, and the last frame is the whole word", () => {
    const frames = logoFrames();
    expect(frames.length).toBeGreaterThan(4);
    const rows = (f: string) => strip(f).split("\n");
    expect(rows(frames[0]!).join("").trim()).toBe("");
    const last = rows(frames.at(-1)!);
    expect(last).toHaveLength(6);
    expect(last[2]).toContain("███████║");
    // every frame has the same shape, so redrawing in place does not jump
    for (const f of frames) expect(rows(f).map((r) => r.length)).toEqual(last.map((r) => r.length));
  });

  test("only for a person: not when piped, not with --json or --quiet, not with NO_COLOR", async () => {
    const shown: string[] = [];
    const io = (tty: boolean, env: Record<string, string> = {}) => ({ isTTY: tty, env, write: (s: string) => void shown.push(s), sleep: async () => {} });
    expect(await showLogo(["--quiet"], io(true))).toBe(false);
    expect(await showLogo(["--json"], io(true))).toBe(false);
    expect(await showLogo([], io(false))).toBe(false);
    expect(await showLogo([], io(true, { NO_COLOR: "1" }))).toBe(false);
    expect(shown).toHaveLength(0);
    expect(await showLogo([], io(true))).toBe(true);
    expect(strip(shown.join(""))).toContain("Evaluate. Correct. Sharpen.");
  });
});
