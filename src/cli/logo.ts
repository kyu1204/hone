// "hone" in cfonts' block letters, lit column by column in a cyan to blue sweep when a person starts a command at a terminal.
import { render } from "cfonts";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
// the letters without cfonts' own colors, so the sweep can color and reveal them column by column
const ROWS = (render("hone", { font: "block", colors: ["system"], space: false, env: "node" }) as { string: string }).string.split("\n").map((r) => r.replace(ANSI, "").trimEnd()).filter((r) => r.trim() !== "");
const WIDTH = Math.max(...ROWS.map((r) => r.length));
// 256-color codes from cyan to blue
const SHADES = [51, 45, 39, 33, 27, 21];
const lit = (ch: string, col: number) => `\x1b[1;38;5;${SHADES[Math.min(SHADES.length - 1, Math.floor((col / WIDTH) * SHADES.length))]}m${ch}\x1b[0m`;

/** One frame per column lit, from none to the whole word. Every frame has the same shape. */
export function logoFrames(): string[] {
  const frames: string[] = [];
  for (let upTo = 0; upTo <= WIDTH + 1; upTo += 2) {
    frames.push(ROWS.map((row) => [...row.padEnd(WIDTH)].map((ch, col) => (ch !== " " && col < upTo ? lit(ch, col) : " ")).join("")).join("\n"));
  }
  return frames;
}

export interface LogoIo {
  isTTY: boolean;
  env: Record<string, string | undefined>;
  write: (s: string) => void;
  sleep: (ms: number) => Promise<void>;
}

/** Plays the logo for a person at a terminal; says whether it did. Never for piped output, --json, --quiet or NO_COLOR. */
export async function showLogo(argv: string[], io: LogoIo): Promise<boolean> {
  if (!io.isTTY || io.env.NO_COLOR || argv.some((a) => a === "--json" || a.startsWith("--json=") || a === "--quiet" || a === "--help" || a === "-h")) return false;
  const frames = logoFrames();
  const pad = (f: string) => f.split("\n").map((r) => `  ${r}`).join("\n");
  io.write(`\x1b[?25l\n${pad(frames[0]!)}\n`);
  for (const f of frames.slice(1)) {
    await io.sleep(18);
    io.write(`\x1b[${ROWS.length}A\r${pad(f)}\n`);
  }
  io.write(`\n  \x1b[2mEvaluate. Correct. Sharpen.\x1b[0m\n\n\x1b[?25h`);
  return true;
}
