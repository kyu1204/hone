import { describe, expect, test } from "bun:test";
import { bar, braillePlot, detectGraphics, kittyImageEscape, sparkline } from "./chart";

describe("chart primitives", () => {
  test("sparkline maps values to the eight block levels and handles flat input", () => {
    const s = sparkline([0, 0.25, 0.5, 0.75, 1], 5);
    expect(s).toHaveLength(5);
    expect(s[0]).toBe("▁");
    expect(s[4]).toBe("█");
    expect(sparkline([0.5, 0.5, 0.5], 3)).toBe("▄▄▄");
    expect(sparkline([], 4)).toBe("    ");
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toHaveLength(5);
  });

  test("braillePlot places points in a width x height grid of braille cells", () => {
    const rows = braillePlot([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }], 10, 4);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => [...r].length === 10)).toBe(true);
    const joined = rows.join("");
    expect([...joined].filter((ch) => ch !== "⠀").length).toBeGreaterThanOrEqual(3);
    // (0,0) is bottom-left, (1,1) top-right
    expect(rows[3]![0]).not.toBe("⠀");
    expect(rows[0]![9]).not.toBe("⠀");
  });

  test("bar draws an interval around a point", () => {
    const b = bar(0.6, 0.4, 0.8, 11);
    expect(b).toHaveLength(11);
    expect(b[6]).toBe("█");
    expect(b[4]).toBe("▒");
    expect(b[0]).toBe("·");
  });

  test("detectGraphics recognises kitty-capable terminals and falls back to cells", () => {
    expect(detectGraphics({ TERM: "xterm-kitty" })).toBe("kitty");
    expect(detectGraphics({ KITTY_WINDOW_ID: "1" })).toBe("kitty");
    expect(detectGraphics({ TERM_PROGRAM: "ghostty" })).toBe("kitty");
    expect(detectGraphics({ TERM_PROGRAM: "WezTerm" })).toBe("kitty");
    expect(detectGraphics({ TERM: "xterm-256color" })).toBe("cells");
    expect(detectGraphics({})).toBe("cells");
  });

  test("kittyImageEscape wraps base64 PNG bytes in the graphics protocol", () => {
    const esc = kittyImageEscape(new Uint8Array([137, 80, 78, 71]), 3, 2);
    expect(esc.startsWith("\u001b_G")).toBe(true);
    expect(esc).toContain("f=100");
    expect(esc).toContain("c=3");
    expect(esc).toContain("r=2");
    expect(esc.endsWith("\u001b\\")).toBe(true);
  });
});
