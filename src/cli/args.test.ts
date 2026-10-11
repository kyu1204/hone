import { describe, expect, test } from "bun:test";
import { parseArgs } from "./args";

const spec = {
  flags: ["adaptive", "quiet", "cache"],
  strings: ["target", "case", "json", "run"],
  numbers: ["trials", "concurrency"],
  repeatable: ["target", "case"],
  optionalValue: ["json"],
} as const;

describe("parseArgs", () => {
  test("flags, values, equals form, repeats, numbers and positionals", () => {
    const r = parseArgs(["run", "--adaptive", "--target", "rag", "--target=cc", "--trials", "5", "--case", "a*", "extra"], spec);
    expect(r.positionals).toEqual(["run", "extra"]);
    expect(r.flags.adaptive).toBe(true);
    expect(r.values.target).toEqual(["rag", "cc"]);
    expect(r.values.case).toEqual(["a*"]);
    expect(r.numbers.trials).toBe(5);
    expect(r.flags.quiet).toBeUndefined();
  });

  test("--no-flag, optional value flags and --help", () => {
    const r = parseArgs(["--no-cache", "--json", "--quiet"], spec);
    expect(r.flags.cache).toBe(false);
    expect(r.values.json).toEqual([""]);
    expect(r.flags.quiet).toBe(true);
    expect(parseArgs(["--help"], spec).help).toBe(true);
    expect(parseArgs(["-h"], spec).help).toBe(true);
  });

  test("unknown options and bad numbers are errors", () => {
    expect(() => parseArgs(["--nope"], spec)).toThrow(/unknown option --nope/);
    expect(() => parseArgs(["--trials", "many"], spec)).toThrow(/--trials expects a number/);
    expect(() => parseArgs(["--run"], spec)).toThrow(/--run expects a value/);
  });

  test("-- ends option parsing", () => {
    const r = parseArgs(["--quiet", "--", "--not-a-flag"], spec);
    expect(r.positionals).toEqual(["--not-a-flag"]);
  });
});
