import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CommandIo } from "./run";
import { sharpenCommand } from "./sharpen";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
// HOME points at an empty directory: a key stored on the developer's machine must never be found, or a test would call a real model
const home = fs.mkdtempSync(path.join(os.tmpdir(), "hone-sharpencmd-home-"));
function io(cwd: string): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env: { HOME: home }, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}
const configModule = new URL("../../core/config.ts", import.meta.url).pathname;

/** 30 cases answered correctly only when the text says UPPERCASE; `target` replaces the system under test. */
function project(opts: { target?: string; sharpen?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-sharpencmd-"));
  dirs.push(dir);
  const fn = '(text) => ({ t: { kind: "fn", version: text, fn: (i) => (text.includes("UPPERCASE") ? String(i).toUpperCase() : String(i)) } })';
  fs.writeFileSync(
    path.join(dir, "hone.config.ts"),
    `import { defineConfig } from ${JSON.stringify(configModule)};
const make = ${fn};
export default defineConfig({
  targets: ${opts.target ?? 'make("Answer.")'},
  cases: Array.from({ length: 30 }, (_, i) => ({ id: "c" + i, input: "w" + i, expected: "W" + i })),
  trials: 1,
  scorers: [{ name: "exact" }],
  ${opts.sharpen === false ? "" : 'sharpen: { text: { seed: "Answer.", apply: (c, text) => ({ ...c, targets: make(text) }) } },'}
});
`,
  );
  return dir;
}
const chat = async (): Promise<{ text: string }> => ({ text: JSON.stringify({ text: "Answer in UPPERCASE.", rationale: "outputs were lowercase", code: "answers-lowercase", definition: "outputs were not capitalised" }) });

describe("hone sharpen", () => {
  test("prints the plain account and leaves the ledger and the new text behind", async () => {
    const dir = project();
    const o = io(dir);
    expect(await sharpenCommand(["--budget", "2", "--no-cache", "--quiet"], o, { chat })).toBe(0);
    expect(o.out).toMatch(/^Now: 0% of 20 cases pass\. 10 more cases are held out for the final check\./);
    expect(o.out).toMatch(/Why it fails:\n {2}1\. answers-lowercase/);
    expect(o.out).toMatch(/Tried 1 change:\n {2}\+ rewrite 1/);
    expect(o.out).toMatch(/Result: PROVEN\. On 10 cases it never saw, rewrite 1 takes the pass rate from 0% to 100%/);
    expect(o.out).toMatch(/The new text is in \.hone\/sharpen\/\d+-best\.txt/);
    expect(o.err).toBe(""); // --quiet
    const files = fs.readdirSync(path.join(dir, ".hone", "sharpen"));
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
    expect(files.some((f) => f.endsWith("-best.txt"))).toBe(true);
  });

  test("progress goes to stderr unless --quiet; --json prints the result document", async () => {
    const dir = project();
    const o = io(dir);
    expect(await sharpenCommand(["--budget", "1", "--no-cache", "--json"], o, { chat })).toBe(0);
    const doc = JSON.parse(o.out) as { verdict: string; candidates: unknown[]; split: { holdout: string[] } };
    expect(doc.verdict).toBe("proven");
    expect(doc.candidates).toHaveLength(1);
    expect(doc.split.holdout).toHaveLength(10);
    expect(o.err).toMatch(/running baseline/);
    expect(o.err).toMatch(/asking for rewrite 1/);
  });

  test("options reach the cycle: --holdout, --seed, --until, --max-cost", async () => {
    const dir = project();
    const half = io(dir);
    expect(await sharpenCommand(["--holdout", "0.5", "--seed", "7", "--no-cache", "--quiet", "--json", "--max-cost", "0"], half, { chat })).toBe(0);
    const doc = JSON.parse(half.out) as { split: { holdout: string[] }; stopped: string; candidates: unknown[] };
    expect(doc.split.holdout).toHaveLength(15);
    expect(doc.stopped).toBe("maxCost");
    expect(doc.candidates).toEqual([]);
  });

  test("without an LLM key it says what is missing instead of failing", async () => {
    const o = io(project());
    expect(await sharpenCommand(["--no-cache", "--quiet"], o)).toBe(0);
    expect(o.out).toMatch(/Nothing to change: sharpen\.text is declared, but there is no LLM key/);
  });

  test("exit codes: 1 when the system cannot be measured, 2 for usage and config errors", async () => {
    const broken = io(project({ target: '{ t: { kind: "fn", fn: () => { throw new Error("boom"); } } }' }));
    expect(await sharpenCommand(["--no-cache", "--quiet"], broken, { chat })).toBe(1);
    expect(broken.out).toMatch(/Cannot measure/);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "hone-sharpencmd-empty-"));
    dirs.push(empty);
    const none = io(empty);
    expect(await sharpenCommand([], none, { chat })).toBe(2);
    expect(none.err).toMatch(/hone init/);
    const bad = io(project());
    expect(await sharpenCommand(["--budget", "many"], bad, { chat })).toBe(2);
    expect(bad.err).toMatch(/usage: hone sharpen/);
    const help = io(project());
    expect(await sharpenCommand(["--help"], help, { chat })).toBe(0);
    expect(help.out).toMatch(/^usage: hone sharpen/);
    expect(help.out).toMatch(/--until/);
  });
});
