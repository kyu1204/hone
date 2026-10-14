// Every example directory must be green under `hone test --ci`; this runs them the way CI does. The sharpen example
// starts broken on purpose and is checked by what `hone sharpen` makes of it. The helpdesk agent calls a model on every
// trial, so nothing here runs it: its cases and scorers are checked on conversations written by hand.
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ciCommand } from "../src/cli/commands/ci";
import { loadCases, type ScorerSpec } from "../src/core/config";
import { createScorers } from "../src/scorers";
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
  test("there are seven, each with a README and cases", () => {
    expect(examples).toEqual(["agent-claude-code", "harness-ablation", "helpdesk-agent", "mcp-server", "qa-fn", "rag-python", "sharpen"]);
    for (const e of examples) {
      expect(fs.existsSync(path.join(here, e, "README.md"))).toBe(true);
      expect(fs.readdirSync(path.join(here, e, "evals")).length).toBeGreaterThan(0);
    }
  });

  // the sharpen example starts broken on purpose: it is there to be improved; the helpdesk agent needs a model
  for (const e of examples.filter((x) => x !== "sharpen" && x !== "helpdesk-agent")) {
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
    expect(o.out.replace(/\s+/g, " ")).toMatch(/Result: PROVEN\. On 6 cases it never saw, loose matching on rewrite 1 takes the pass rate from 0% to 100% \(\+100 points/); // sentences wrap at 100 columns
    expect(o.out).toContain('It uses the change "loose matching" from sharpen/loose-matching.ts.');

    // without a key the cycle still runs, tries what needs no model, and says what it skipped
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "hone-examples-home-"));
    cleanups.push(() => fs.rmSync(empty, { recursive: true, force: true }));
    const offline = io(cwd, { HOME: empty });
    offline.env = { HOME: empty };
    expect(await sharpenCommand(["--quiet", "--no-cache"], offline)).toBe(0);
    expect(offline.out).toMatch(/Result: NO GAIN\. The one change tried did not beat what you have\./);
    expect(offline.out).toMatch(/No LLM key/);
    for (const out of [o.out, offline.out]) expect(Math.max(...out.split("\n").map((l) => l.length))).toBeLessThanOrEqual(100);
  });

  describe("helpdesk-agent", () => {
    const cwd = path.join(here, "helpdesk-agent");
    const RULES = ["cite", "verify", "lookup", "ticket", "security", "nopolicy"];
    type Score = { pass: boolean | null; reason: string };
    type Config = { targets: Record<string, { kind: string; module: string; params: Record<string, string> }>; scorers: ScorerSpec[]; sharpen: { text: { seed: string; apply: (c: Config, text: string) => Config }; variants: Record<string, (c: Config) => Config> } };
    const load = async (): Promise<Config> => ((await import(path.join(cwd, "hone.config.ts"))) as { default: Config }).default;
    const cases = async () => (await loadCases("evals/*.yaml", cwd)) as { id: string; input: { from: string; message: string }; expected: Record<string, unknown>; tags: string[] }[];
    // a conversation as the python target records it: the tool calls the agent made, then what it answered
    const said = (calls: [string, Record<string, string>][], output: string) => ({ output, spans: [], messages: [{ role: "user", content: "q" }, ...calls.map(([name, args], i) => ({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] })), { role: "assistant", content: output }] });
    const judge = async (id: string, calls: [string, Record<string, string>][], output: string): Promise<{ pass: boolean; reasons: string }> => {
      const [config, all] = [await load(), await cases()];
      // the built-in agent scorer reads what each case expects of the conversation
      expect(config.scorers).toEqual([{ name: "agent" }]);
      const scores = (await Promise.all(createScorers(config.scorers).map((s) => s.score({ case: all.find((c) => c.id === id)! as never, trace: said(calls, output) as never, trial: 0 })))) as Score[];
      return { pass: scores.every((s) => s.pass !== false), reasons: scores.filter((s) => s.pass === false).map((s) => s.reason).join("; ") };
    };

    test("the same agent in two frameworks, and a prompt hone may rewrite", async () => {
      const config = await load();
      expect(Object.keys(config.targets)).toEqual(["langchain", "strands"]);
      expect(Object.values(config.targets).map((t) => `${t.kind} ${t.module}`)).toEqual(["python langchain_agent", "python strands_agent"]);
      for (const f of ["helpdesk.py", "langchain_agent.py", "strands_agent.py", "pyproject.toml"]) expect(fs.existsSync(path.join(cwd, f))).toBe(true);
      // a new text or another model reaches both agents through params
      const rewritten = config.sharpen.text.apply(config, "new prompt");
      expect(Object.values(rewritten.targets).map((t) => t.params.system_prompt)).toEqual(["new prompt", "new prompt"]);
      expect(Object.values(config.targets).map((t) => t.params.system_prompt)).toEqual([config.sharpen.text.seed, config.sharpen.text.seed]);
      const larger = config.sharpen.variants["model: sonnet"]!(config);
      expect(Object.values(larger.targets).map((t) => t.params.model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5"]);
    });

    test("36 cases: six for each of six house rules, each written by a known employee", async () => {
      const all = await cases();
      expect(all.length).toBe(36);
      expect(new Set(all.map((c) => c.id)).size).toBe(36);
      for (const rule of RULES) expect(all.filter((c) => c.tags[0] === rule).length).toBe(6);
      for (const c of all) {
        expect(c.input.from).toMatch(/^[a-z]+\.[a-z]+@acme\.example$/);
        expect(Object.keys(c.expected).length).toBeGreaterThan(0);
        for (const key of Object.keys(c.expected)) expect(["calls", "never", "order", "args", "says", "never_says", "judge"]).toContain(key);
      }
    });

    test("the scorers pass a conversation that keeps the rule and name the rule a conversation breaks", async () => {
      const search: [string, Record<string, string>] = ["search_policy", { query: "meals" }];
      // cite: the answer carries the policy id in brackets
      expect((await judge("cite-expenses", [search], "Meals are reimbursed up to 30,000 KRW per person [P-03].")).pass).toBe(true);
      expect((await judge("cite-expenses", [search], "Up to 30,000 KRW per person, per policy P-03.")).reasons).toBe('the answer does not contain "[P-03]"');
      // verify: no reset without a verified employee ID
      const verify: [string, Record<string, string>] = ["verify_identity", { email: "leo.kim@acme.example", employee_id: "E2210" }];
      const reset: [string, Record<string, string>] = ["reset_password", { email: "leo.kim@acme.example" }];
      expect((await judge("reset-with-id", [verify, reset], "Done, a temporary password is on its way.")).pass).toBe(true);
      expect((await judge("reset-with-id", [reset, verify], "Done.")).reasons).toBe("called reset_password before verify_identity");
      expect((await judge("reset-no-id", [], "Please send me your employee ID first.")).pass).toBe(true);
      expect((await judge("reset-no-id", [reset], "Done. What is your employee ID, for the record?")).reasons).toBe("called reset_password, which this case does not allow");
      // lookup: the balance comes from the tool
      expect((await judge("leave-left", [["get_leave_balance", { email: "mina.park@acme.example" }]], "You have 9.5 days left.")).pass).toBe(true);
      expect((await judge("leave-left", [search], "Full-time employees get 15 days a year.")).reasons).toBe('did not call get_leave_balance; the answer does not contain "9.5"');
      // ticket: the right category and priority, and the ticket id in the answer
      const ticket = (category: string, priority: string): [string, Record<string, string>] => ["create_ticket", { category, priority, summary: "s", requester_email: "leo.kim@acme.example" }];
      expect((await judge("ticket-laptop-dead", [ticket("hardware", "high")], "I opened T-1001 for you.")).pass).toBe(true);
      expect((await judge("ticket-laptop-dead", [ticket("hardware", "normal")], "I opened T-1001 for you.")).reasons).toBe('create_ticket was called with priority "normal"; this case needs "high"');
      // security: always urgent, and the address to write to
      expect((await judge("sec-phishing-click", [ticket("security", "urgent")], "Ticket T-1002 is open. Write to security@acme.example within the hour.")).pass).toBe(true);
      expect((await judge("sec-phishing-click", [ticket("security", "high")], "Ticket T-1002 is open.")).reasons).toBe('create_ticket was called with priority "high"; this case needs "urgent"; the answer does not contain "security@acme.example"');
      // no policy: say so, cite nothing, and hand the question on
      expect((await judge("nopolicy-dog", [search, ticket("other", "low")], "No policy covers this. I opened T-1003 so someone can tell you.")).pass).toBe(true);
      expect((await judge("nopolicy-dog", [search], "Pets are welcome on Fridays [P-02].")).reasons).toBe('did not call create_ticket; the answer contains "[P-", which it must not');
    });
  });

  test("agent-claude-code falls back to replay traces when claude is not installed", async () => {
    const cwd = path.join(here, "agent-claude-code");
    const { default: config } = (await import(path.join(cwd, "hone.config.ts"))) as { default: { targets: Record<string, { kind: string }> } };
    const kind = config.targets.cc!.kind;
    expect(["replay", "process"]).toContain(kind);
    if (!Bun.which("claude") || process.env.CI) expect(kind).toBe("replay");
  });
});
