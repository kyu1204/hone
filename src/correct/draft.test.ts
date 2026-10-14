import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HoneConfig } from "../core/config";
import type { Case } from "../core/types";
import { defaultReads, draftCases } from "./draft";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function project(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-draft-"));
  dirs.push(d);
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(d, f), c);
  return d;
}
const config = (module = "agent"): HoneConfig => ({
  targets: { helpdesk: { kind: "python", module, fn: "answer" } },
  cases: [],
  scorers: [{ name: "agent" }],
  trials: 1,
  sharpen: { text: { seed: "You are the Acme helpdesk assistant.", apply: (c) => c } },
});
const AGENT = "import os\nimport helpdesk\nfrom tools import lookup\n\ndef answer(input, ctx):\n    return helpdesk.run(input)\n";
const HELPDESK = 'POLICIES = {"P-09": "Security tickets always have priority urgent."}\n\ndef create_ticket(category, priority):\n    """Create a helpdesk ticket."""\n\ndef reset_password(email):\n    """Reset a password."""\n';

describe("draftCases", () => {
  test("by default it reads the python module and the files next to it that the module imports", () => {
    const d = project({ "agent.py": AGENT, "helpdesk.py": HELPDESK, "tools.py": "def lookup(): ...\n", "unrelated.py": "x = 1\n" });
    expect(defaultReads(config(), d)).toEqual(["agent.py", "helpdesk.py", "tools.py"]);
    expect(defaultReads(config("agent.py"), d)).toEqual(["agent.py", "helpdesk.py", "tools.py"]);
    expect(defaultReads({ ...config(), targets: { web: { kind: "http", url: "http://x" } } }, d)).toEqual([]);
  });

  test("cases come back in the agent grammar; malformed ones and ones that name a tool the code does not have are dropped", async () => {
    const d = project({ "agent.py": AGENT, "helpdesk.py": HELPDESK, "tools.py": "def lookup(): ...\n" });
    const prompts: string[] = [];
    const reply = {
      cases: [
        { id: "lost-laptop", input: "I left my laptop on the bus", expected: { calls: ["create_ticket"], args: { create_ticket: { priority: "urgent" } } }, why: "P-09: security tickets are urgent" },
        { id: "reset-ok", input: "reset my password", expected: { never: ["reset_password"], judge: "asks for the employee ID first" }, why: "a reset needs a verified identity" },
        { id: "email", input: "mail my manager", expected: { calls: ["send_email"] }, why: "made up" },
        { id: "wrong-key", input: "hi", expected: { must: "greet" }, why: "x" },
        { id: "no-input", expected: { judge: "x" }, why: "x" },
        { id: "greets", input: "hi", expected: { judge: "greets the employee and offers help" } },
        { id: "one-word", input: "hello", expected: { says: "hello" } },
      ],
    };
    const existing: Case[] = [{ id: "reset-ok", input: "old", expected: { says: ["ID"] } }];
    const r = await draftCases({ config: config(), cwd: d, existing, count: 6, chat: async (req) => (prompts.push(JSON.stringify(req.messages)), { text: `Here they are:\n${JSON.stringify(reply)}` }) });
    expect(r.read).toEqual(["agent.py", "helpdesk.py", "tools.py"]);
    // what the model was shown: the prompt, the code, and the cases there are
    expect(prompts[0]).toContain("You are the Acme helpdesk assistant.");
    expect(prompts[0]).toContain("def create_ticket");
    expect(prompts[0]).toContain("reset-ok");
    expect(prompts[0]).toContain("Write 6 new cases");
    // a case is one message to a fresh agent: a flow that needs an earlier turn or saved state cannot be tested this way
    expect(prompts[0]).toContain("no earlier conversation and nothing saved from one");
    expect(r.cases.map((c) => c.id)).toEqual(["lost-laptop", "reset-ok-2", "greets", "one-word"]); // an id that is taken gets a number
    expect(r.cases[3]!.expected).toEqual({ says: ["hello"] }); // one word where a list goes is a list of one
    expect(r.cases[0]).toEqual({ id: "lost-laptop", input: "I left my laptop on the bus", expected: { calls: ["create_ticket"], args: { create_ticket: { priority: "urgent" } } }, tags: ["drafted"], meta: { why: "P-09: security tickets are urgent" } });
    expect(r.dropped).toEqual(["email: names a tool the code does not have: send_email", "wrong-key: expected may only say calls, never, order, args, says, never_says or judge", "no-input: no input"]);
  });

  test("a reply that is not a list of cases is an error, not an empty draft", async () => {
    const d = project({ "agent.py": AGENT, "helpdesk.py": HELPDESK, "tools.py": "" });
    await expect(draftCases({ config: config(), cwd: d, existing: [], chat: async () => ({ text: "I would rather not." }) })).rejects.toThrow(/did not reply with cases/);
    await expect(draftCases({ config: { ...config(), targets: { web: { kind: "http", url: "http://x" } }, sharpen: undefined }, cwd: d, existing: [], chat: async () => ({ text: "{}" }) })).rejects.toThrow(/nothing to read/);
  });
});
