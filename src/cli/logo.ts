// "hone" in cfonts' block letters, forming out of scattered dots when a person starts a command at a terminal.
import { render } from "cfonts";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
// the letters without cfonts' own colors, so the sweep can color and reveal them column by column
const ROWS = (render("hone", { font: "block", colors: ["system"], space: false, env: "node" }) as { string: string }).string.split("\n").map((r) => r.replace(ANSI, "").trimEnd()).filter((r) => r.trim() !== "");
const WIDTH = Math.max(...ROWS.map((r) => r.length));
// 256-color codes from cyan to blue, and a bright band that sweeps across once the word has formed
const SHADES = [51, 45, 39, 33, 27, 21];
const shade = (col: number): number => SHADES[Math.min(SHADES.length - 1, Math.floor((col / WIDTH) * SHADES.length))]!;
const paint = (ch: string, code: number) => `\x1b[1;38;5;${code}m${ch}\x1b[0m`;
const STAGES = ["░", "▒", "▓"];
const FORM = 22; // frames for the dots to form the letters
const SHINE = 10; // frames for the band to cross

// each cell starts forming at its own moment; seeded, so every run (and the test) sees the same dance
function starts(): number[][] {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return ROWS.map((row) => [...row.padEnd(WIDTH)].map((_, col) => 1 + Math.floor(rand() * (FORM - STAGES.length - 2) * 0.6 + (col / WIDTH) * (FORM - STAGES.length - 2) * 0.4)));
}

/** The dots scatter in, pass through ░ ▒ ▓ into the letters, then a bright band sweeps across. Every frame has the same shape. */
export function logoFrames(): string[] {
  const t0 = starts();
  const frames: string[] = [];
  for (let f = 0; f < FORM + SHINE; f++) {
    const band = f >= FORM ? ((f - FORM) / (SHINE - 1)) * (WIDTH + 8) - 4 : -99;
    frames.push(
      ROWS.map((row, r) =>
        [...row.padEnd(WIDTH)]
          .map((ch, col) => {
            if (ch === " ") return " ";
            const age = f - t0[r]![col]!;
            if (age < 0) return " ";
            if (age < STAGES.length) return paint(STAGES[age]!, shade(col));
            return paint(ch, Math.abs(col - band) < 3 ? 231 : shade(col));
          })
          .join(""),
      ).join("\n"),
    );
  }
  // the last frame is the word at rest
  frames.push(ROWS.map((row) => [...row.padEnd(WIDTH)].map((ch, col) => (ch === " " ? " " : paint(ch, shade(col)))).join("")).join("\n"));
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
    await io.sleep(28);
    io.write(`\x1b[${ROWS.length}A\r${pad(f)}\n`);
  }
  io.write(`\n  \x1b[2mEvaluate. Correct. Sharpen.\x1b[0m\n\n\x1b[?25h`);
  return true;
}
