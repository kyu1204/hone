import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadCases } from "../../core/config";
import { draftCommand } from "./draft";
import { initCommand } from "./init";
import type { CommandIo } from "./run";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const libraryEntry = new URL("../../index.ts", import.meta.url).pathname;
function io(cwd: string, extraEnv: Record<string, string> = {}): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env: { HOME: cwd, HONE_CONFIG_IMPORT: libraryEntry, ...extraEnv }, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-draft-"));
  dirs.push(d);
  return d;
}

describe("hone draft", () => {
  test("hone's model drafts cases from what the agent is, runs them once and says which fail", async () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, "evals"));
    fs.writeFileSync(path.join(d, "tools.py"), "def create_ticket(category, priority):\n    ...\n");
    // a bot that files every ticket as high
    fs.writeFileSync(
      path.join(d, "hone.config.ts"),
      `import { defineConfig } from ${JSON.stringify(libraryEntry)};
const said = (input) => String(input).includes("laptop")
  ? { output: "Ticket T-1 is open.", messages: [{ role: "user", content: String(input) }, { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "create_ticket", arguments: JSON.stringify({ category: "security", priority: "high" }) } }] }, { role: "assistant", content: "Ticket T-1 is open." }] }
  : { output: "Hello! How can I help?", messages: [{ role: "user", content: String(input) }, { role: "assistant", content: "Hello! How can I help?" }] };
export default defineConfig({ targets: { bot: { kind: "fn", fn: said } }, cases: "evals/*.yaml", scorers: [{ name: "agent" }], trials: 1, sharpen: { text: { seed: "You are the helpdesk.", apply: (c) => c } } });
`,
    );
    const reply = { cases: [
      { id: "lost-laptop", input: "I lost my laptop", expected: { calls: ["create_ticket"], args: { create_ticket: { priority: "urgent" } } }, why: "security incidents are urgent" },
      { id: "greeting", input: "hi", expected: { says: ["hello"] }, why: "greets" },
      { id: "made-up", input: "mail my boss", expected: { calls: ["send_email"] } },
    ] };
    const asked: string[] = [];
    const chat = async (req: { messages: { content: unknown }[] }) => (asked.push(JSON.stringify(req.messages)), { text: JSON.stringify(reply) });
    const o = io(d);
    expect(await draftCommand(["--read", "tools.py", "--count", "3"], o, { chat })).toBe(0);
    expect(asked[0]).toContain("def create_ticket");
    const drafted = await loadCases("evals/drafted.yaml", d);
    expect(drafted.map((c) => c.id)).toEqual(["lost-laptop", "greeting"]);
    const out = o.out.replace(/\s+/g, " ");
    expect(out).toContain("Drafted 2 cases into evals/drafted.yaml, from tools.py and the prompt in hone.config.ts.");
    expect(out).toContain("Dropped 1: made-up: names a tool the code does not have: send_email");
    expect(out).toContain("Ran them once: 1 passes, 1 fails.");
    expect(out).toContain('lost-laptop create_ticket was called with priority "high"; this case needs "urgent"');
    expect(out).toContain("Read evals/drafted.yaml: keep the cases that say what the agent should do and delete the rest. Then: hone test, hone sharpen.");
    // again: the new drafts are added, under ids not yet taken
    expect(await draftCommand(["--read", "tools.py"], io(d), { chat })).toBe(0);
    expect((await loadCases("evals/drafted.yaml", d)).map((c) => c.id)).toEqual(["lost-laptop", "greeting", "lost-laptop-2", "greeting-2"]);
  });

  test("says what is missing: a config, or a key for the model", async () => {
    const bare = io(tmp());
    expect(await draftCommand([], bare, { chat: async () => ({ text: "{}" }) })).toBe(2);
    expect(bare.err).toMatch(/no hone.config.ts here: run hone init first, then hone draft/);
    const d = tmp();
    expect(await initCommand(["--yes", "--no-keys", "--no-agents"], io(d))).toBe(0);
    const keyless = io(d); // HOME is the project: no key anywhere
    expect(await draftCommand([], keyless)).toBe(2);
    expect(keyless.err).toMatch(/drafting cases needs an LLM key/);
  });
});
