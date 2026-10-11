// Color tokens for the TUI. NO_COLOR disables colors (everything becomes undefined so the
// terminal default applies).
export interface Theme {
  accent: string | undefined;
  pass: string | undefined;
  fail: string | undefined;
  undecided: string | undefined;
  flag: string | undefined;
  muted: string | undefined;
  fg: string | undefined;
}

const COLORS: Theme = { accent: "#6fb1dc", pass: "#6cc08b", fail: "#ff8a80", undecided: "#9aa3b2", flag: "#e0a84a", muted: "#9aa3b2", fg: undefined };
const PLAIN: Theme = { accent: undefined, pass: undefined, fail: undefined, undecided: undefined, flag: undefined, muted: undefined, fg: undefined };

export function themeFor(env: Record<string, string | undefined> = process.env): Theme {
  return env.NO_COLOR !== undefined && env.NO_COLOR !== "" ? PLAIN : COLORS;
}

const current = themeFor();
export function useTheme(): Theme {
  return current;
}
