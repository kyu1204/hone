// Every example directory must be green under `hone test --ci`; this runs them the way CI does. The sharpen example
// starts broken on purpose and is checked by what `hone sharpen` makes of it.
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ciCommand } from "../src/cli/commands/ci";
import { type CommandIo, runCommand } from "../src/cli/commands/run";
import { sharpenCommand } from "../src/cli/commands/sharpen";
import { startRagServer } from "./rag-python/start";

const here = new URL(".", import.meta.url).pathname;
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});
function io(cwd: string, env: Record<string, string> = {}): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env: { ...process.env, ...env } as Record<string, string | undefined>, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}
const examples = fs.readdirSync(here).filter((f) => fs.existsSync(path.join(here, f, "hone.config.ts"))).sort();

describe("examples", () => {
  test("there are six, each with a README and cases", () => {
    expect(examples).toEqual(["agent-claude-code", "harness-ablation", "mcp-server", "qa-fn", "rag-python", "sharpen"]);
    for (const e of examples) {
      expect(fs.existsSync(path.join(here, e, "README.md"))).toBe(true);
      expect(fs.readdirSync(path.join(here, e, "evals")).length).toBeGreaterThan(0);
    }
  });

  // the sharpen example starts broken on purpose: it is there to be improved
  for (const e of examples.filter((x) => x !== "sharpen")) {
    test(`${e}: hone test --ci is green`, async () => {
      const cwd = path.join(here, e);
      const env: Record<string, string> = { CI: "1" };
      const prevCi = process.env.CI;
      process.env.CI = "1"; // configs read process.env (agent-claude-code picks replay)
      cleanups.push(() => void (prevCi === undefined ? delete process.env.CI : (process.env.CI = prevCi)));
      if (e === "rag-python") {
        const server = await startRagServer(cwd);
        cleanups.push(server.stop);
        env.RAG_URL = server.url;
        process.env.RAG_URL = server.url; // the config reads process.env at import time
        cleanups.push(() => void delete process.env.RAG_URL);
      }
      cleanups.push(() => fs.rmSync(path.join(cwd, ".hone"), { recursive: true, force: true }));
      const o = io(cwd, env);
      const rc = await ciCommand(["--quiet", "--no-cache"], o);
      expect(`${o.err}\n${o.out}`).not.toMatch(/config error|unknown/);
      expect(rc).toBe(0);
      expect(o.out).toMatch(/passAt1/);
    }, 120_000);
  }

  test("sharpen: nothing passes as written; hone sharpen finds that the change file and a rewrite only work together", async () => {
    const cwd = path.join(here, "sharpen");
    fs.rmSync(path.join(cwd, ".hone"), { recursive: true, force: true }); // an earlier run by hand must not have worn the held-out cases
    cleanups.push(() => fs.rmSync(path.join(cwd, ".hone"), { recursive: true, force: true }));
    const before = io(cwd);
    expect(await runCommand(["--quiet", "--no-cache", "--json"], before)).toBe(0);
    expect((JSON.parse(before.out) as { summary: { totals: { passAt1: number } } }).summary.totals.passAt1).toBe(0);

    const chat = async (): Promise<{ text: string }> => ({ text: JSON.stringify({ text: "Reply with only the answer.", rationale: "the cases expect the bare answer", code: "chatty-wrapper", definition: "the answer is wrapped in a sentence" }) });
    const o = io(cwd);
    expect(await sharpenCommand(["--quiet", "--no-cache"], o, { chat })).toBe(0);
    expect(o.out).toMatch(/^Now: 0% of 12 cases pass\. 6 more cases are held out for the final check\./);
    expect(o.out).toMatch(/- loose matching\s+0% -> 0%/);
    expect(o.out).toMatch(/\+ rewrite 1\s+0% -> 50%/);
    expect(o.out).toMatch(/\+ loose matching on rewrite 1\s+0% -> 100%/);
    expect(o.out).toMatch(/Result: PROVEN\. On 6 cases it never saw, loose matching on rewrite 1 takes the pass rate from 0% to 100%/);
    expect(o.out).toContain('It uses the change "loose matching" from sharpen/loose-matching.ts.');

    // without a key the cycle still runs, tries what needs no model, and says what it skipped
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "hone-examples-home-"));
    cleanups.push(() => fs.rmSync(empty, { recursive: true, force: true }));
    const offline = io(cwd, { HOME: empty });
    offline.env = { HOME: empty };
    expect(await sharpenCommand(["--quiet", "--no-cache"], offline)).toBe(0);
    expect(offline.out).toMatch(/Result: NO GAIN\. The one change tried did not beat what you have\./);
    expect(offline.out).toMatch(/No LLM key/);
  });

  test("agent-claude-code falls back to replay traces when claude is not installed", async () => {
    const cwd = path.join(here, "agent-claude-code");
    const { default: config } = (await import(path.join(cwd, "hone.config.ts"))) as { default: { targets: Record<string, { kind: string }> } };
    const kind = config.targets.cc!.kind;
    expect(["replay", "process"]).toContain(kind);
    if (!Bun.which("claude") || process.env.CI) expect(kind).toBe("replay");
  });
});
