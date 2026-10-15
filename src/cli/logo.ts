// The word "hone" in dots, lit column by column when a person starts a command at a terminal.

const GLYPHS = [
  ["●●     ", "●●     ", "●●●●●● ", "●●   ●●", "●●   ●●", "●●   ●●", "●●   ●●"], // h
  ["       ", "       ", " ●●●●● ", "●●   ●●", "●●   ●●", "●●   ●●", " ●●●●● "], // o
  ["       ", "       ", "●●●●●● ", "●●   ●●", "●●   ●●", "●●   ●●", "●●   ●●"], // n
  ["       ", "       ", " ●●●●● ", "●●   ●●", "●●●●●●●", "●●     ", " ●●●●●●"], // e
];
const ROWS = GLYPHS[0]!.map((_, r) => GLYPHS.map((g) => g[r]).join(" "));
const WIDTH = ROWS[0]!.length;
// a cyan to blue sweep across the word (256-color codes)
const SHADES = [51, 45, 39, 33, 27];
const lit = (col: number) => `\x1b[1;38;5;${SHADES[Math.min(SHADES.length - 1, Math.floor((col / WIDTH) * SHADES.length))]}m●\x1b[0m`;
const off = "\x1b[2m·\x1b[0m";

/** One frame per column lit, from none to the whole word. Every frame has the same shape. */
export function logoFrames(): string[] {
  const frames: string[] = [];
  for (let upTo = 0; upTo <= WIDTH; upTo++) {
    frames.push(ROWS.map((row) => [...row].map((ch, col) => (ch === "●" && col < upTo ? lit(col) : ch === "●" ? off : " ")).join("")).join("\n"));
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
