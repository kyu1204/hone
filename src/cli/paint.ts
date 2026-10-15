// Colors and bars for what a person reads in a terminal. Off, every style returns its text unchanged, so piped output,
// --json, the MCP server and the tests see the plain account.

export type Badge = "proven" | "promising" | "none" | "bad";

export interface Paint {
  on: boolean;
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
  /** A share from 0 to 1 in green, yellow or red. */
  rate: (share: number, s: string) => string;
  badge: (kind: Badge, s: string) => string;
}

export function colorOn(env: Record<string, string | undefined>, isTTY: boolean): boolean {
  if (env.NO_COLOR) return false;
  return Boolean(env.FORCE_COLOR) || isTTY;
}

const sgr = (on: boolean, open: string) => (s: string) => (on ? `\x1b[${open}m${s}\x1b[0m` : s);

export function paint(on = false): Paint {
  const green = sgr(on, "32");
  const red = sgr(on, "31");
  const yellow = sgr(on, "33");
  const badges: Record<Badge, (s: string) => string> = { proven: sgr(on, "1;30;42"), promising: sgr(on, "1;30;43"), none: sgr(on, "1;30;47"), bad: sgr(on, "1;37;41") };
  return {
    on,
    bold: sgr(on, "1"),
    dim: sgr(on, "2"),
    green,
    red,
    yellow,
    cyan: sgr(on, "36"),
    rate: (share, s) => (share >= 0.8 ? green(s) : share >= 0.5 ? yellow(s) : red(s)),
    badge: (kind, s) => (on ? badges[kind](` ${s} `) : s),
  };
}

export function bar(share: number, width = 10): string {
  const full = Math.round(Math.min(1, Math.max(0, share)) * width);
  return "█".repeat(full) + "░".repeat(width - full);
}

const share = (pct: string) => Number(pct) / 100;

/** The sharpen account with a badge for the verdict, bars for pass rates, and the tried changes in green or dim. */
export function decorateSharpen(message: string, p: Paint): string {
  if (!p.on) return message;
  return message
    .split("\n")
    .map((line) => {
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^Now: (\d+)% (.*)$/))) return `${p.bold("Now:")} ${p.rate(share(m[1]!), `${m[1]}% ${bar(share(m[1]!))}`)} ${m[2]}`;
      if (line === "Why it fails:" || /^Tried \d+ changes?:$/.test(line)) return p.bold(line);
      if ((m = line.match(/^( {2}\d+\. )(\S+)(.*)$/))) return `${m[1]}${p.yellow(m[2]!)}${p.dim(m[3]!)}`;
      if ((m = line.match(/^( {2})([+-])( .*?)(\d+)% -> (\d+)%(.*)$/))) {
        const up = m[2] === "+";
        const after = `${m[5]}% ${bar(share(m[5]!))}`;
        return `${m[1]}${up ? p.green("+") : p.dim("-")}${up ? p.bold(m[3]!) : p.dim(m[3]!)}${m[4]}% -> ${up ? p.green(after) : p.dim(after)}${p.dim(m[6]!)}`;
      }
      if ((m = line.match(/^Result: (PROVEN|PROMISING, not proven|NO GAIN)\.(.*)$/))) {
        const kind: Badge = m[1] === "PROVEN" ? "proven" : m[1] === "NO GAIN" ? "none" : "promising";
        return `${p.bold("Result:")} ${p.badge(kind, m[1]!)}${m[2]}`;
      }
      if ((m = line.match(/^(Cannot measure:)(.*)$/))) return `${p.badge("bad", m[1]!)}${m[2]}`;
      return line;
    })
    .join("\n");
}
