import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createTarget } from "./index";
import { parseClaudeStream } from "./parsers/claudeCode";
import { parseCodexStream } from "./parsers/codex";
import { renderPrefix } from "./process";
import type { RunContext } from "./target";

const ctx: RunContext = { runId: "r", caseId: "c1", trial: 0 };
const fixtures = new URL("../../test/fixtures/agents/", import.meta.url).pathname;
const dirs: string[] = [];
function workspace(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-ws-"));
  fs.writeFileSync(path.join(d, "README.md"), "# demo\n");
  fs.mkdirSync(path.join(d, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(d, "node_modules", "x", "big.js"), "ignored");
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const fakeAgent = ["bun", path.join(fixtures, "fake-agent.ts")];

describe("process target (generic)", () => {
  test("runs in an isolated copy, captures stdout JSON, diff, spans and leaves the source untouched", async () => {
    const ws = workspace();
    const t = createTarget("agent", { kind: "process", agent: "generic", workspace: ws, command: [...fakeAgent, "{prompt}"] });
    const out = await t.run("add a greeting", ctx);
    expect(out.error).toBeUndefined();
    expect(out.output).toBe("done: add a greeting");
    expect(out.messages?.at(-1)).toMatchObject({ role: "assistant", content: "done: add a greeting" });
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 4, costUsd: 0.002 });
    expect(out.artifacts?.diff).toContain("+hello");
    expect(out.artifacts?.diff).toContain("greeting.txt");
    expect(out.artifacts?.stdout).toContain("done");
    expect(out.spans?.[0]?.kind).toBe("agent");
    expect(fs.existsSync(path.join(ws, "greeting.txt"))).toBe(false);
    expect(fs.existsSync(path.join(ws, "README.md"))).toBe(true);
    await t.close?.();
  });

  test("workspace may contain {caseId}: each case runs in its own directory, and node_modules is linked into the copy", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-ws-cases-"));
    dirs.push(root);
    for (const c of ["alpha", "beta"]) {
      fs.mkdirSync(path.join(root, c, "node_modules", "dep"), { recursive: true });
      fs.writeFileSync(path.join(root, c, "node_modules", "dep", "index.js"), "module.exports = 1;");
      fs.writeFileSync(path.join(root, c, "name.txt"), c);
    }
    const t = createTarget("agent", { kind: "process", agent: "generic", workspace: path.join(root, "{caseId}"), command: ["bash", "-c", "cat name.txt; ls node_modules/dep/index.js >/dev/null && echo linked; echo changed >> name.txt"] });
    const a = await t.run("go", { runId: "r", caseId: "alpha", trial: 0 });
    const b = await t.run("go", { runId: "r", caseId: "beta", trial: 0 });
    expect(String(a.output)).toContain("alpha");
    expect(String(a.output)).toContain("linked");
    expect(String(b.output)).toContain("beta");
    expect(fs.readFileSync(path.join(root, "alpha", "name.txt"), "utf8")).toBe("alpha"); // the source is untouched
    expect(a.meta?.workspace).not.toBe(path.join(root, "alpha"));
    const missing = await t.run("go", { runId: "r", caseId: "gamma", trial: 0 });
    expect(missing.error).toMatch(/workspace .*gamma.* does not exist/);
    await t.close?.();
  });

  test("plain stdout becomes the output when it is not JSON", async () => {
    const t = createTarget("agent", { kind: "process", agent: "generic", workspace: workspace(), command: ["echo", "plain {prompt}"] });
    const out = await t.run("hi", ctx);
    expect(out.output).toBe("plain hi");
    expect(out.artifacts?.diff).toBe("");
  });

  test("a timeout kills the process and reports error=timeout", async () => {
    const t = createTarget("agent", { kind: "process", agent: "generic", workspace: workspace(), command: ["sleep", "5"], timeoutMs: 100 });
    const out = await t.run("x", ctx);
    expect(out.error).toBe("timeout");
  });

  test("a non-zero exit is reported with stderr", async () => {
    const t = createTarget("agent", { kind: "process", agent: "generic", workspace: workspace(), command: ["bash", "-c", "echo oops >&2; exit 3"] });
    const out = await t.run("x", ctx);
    expect(out.error).toMatch(/exit code 3/);
    expect(out.artifacts?.stderr).toContain("oops");
  });

  test("a non-zero exit with nothing on stderr reports what the agent said on stdout", async () => {
    const t = createTarget("agent", { kind: "process", agent: "generic", workspace: workspace(), command: ["bash", "-c", "echo \"You've hit your session limit\"; exit 1"] });
    const out = await t.run("x", ctx);
    expect(out.error).toBe("generic exited with exit code 1: You've hit your session limit");
  });

  test("the child does not inherit the variables of a Claude Code session hone was started from", async () => {
    const session = { CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ID: "parent", CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/parent.sock", CLAUDE_CODE_MESSAGING_TOKEN: "t", CLAUDE_CODE_EXECPATH: "/x", CLAUDE_EFFORT: "max", CLAUDE_PID: "1" };
    const user = { CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1", HONE_TEST_KEEP: "yes" };
    const before = Object.fromEntries(Object.keys({ ...session, ...user }).map((k) => [k, process.env[k]]));
    Object.assign(process.env, session, user);
    try {
      const names = ["bash", "-c", "env | cut -d= -f1 | grep -E '^(CLAUDE|HONE_TEST)' | sort"];
      const inherited = await createTarget("agent", { kind: "process", agent: "generic", workspace: workspace(), command: names }).run("x", ctx);
      const seen = String(inherited.output).split("\n");
      // what marks the launching session is gone; what the user configured stays
      expect(seen.filter((n) => n in session)).toEqual([]);
      expect(seen).toEqual(expect.arrayContaining(Object.keys(user)));
      const explicit = await createTarget("agent", { kind: "process", agent: "generic", workspace: workspace(), command: ["bash", "-c", "echo $CLAUDE_EFFORT"], env: { CLAUDE_EFFORT: "low" } }).run("x", ctx);
      expect(explicit.output).toBe("low"); // the target's own env always wins
    } finally {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("isolate none runs in place inside a git repo and refuses without one", async () => {
    const ws = workspace();
    const noGit = createTarget("agent", { kind: "process", agent: "generic", workspace: ws, isolate: "none", command: ["echo", "x"] });
    expect((await noGit.run("x", ctx)).error).toMatch(/git repository/);
    Bun.spawnSync(["git", "init", "-q"], { cwd: ws });
    const t = createTarget("agent", { kind: "process", agent: "generic", workspace: ws, isolate: "none", command: ["bash", "-c", "echo x > inplace.txt; echo ok"] });
    const out = await t.run("x", ctx);
    expect(fs.existsSync(path.join(ws, "inplace.txt"))).toBe(true);
    expect(out.artifacts?.diff).toContain("inplace.txt");
  });

  test("resume renders the prefix into the prompt", async () => {
    const t = createTarget("agent", { kind: "process", agent: "generic", workspace: workspace(), command: ["bash", "-c", 'printf "%s" "$1"', "_", "{prompt}"] });
    const out = await t.resume!([{ role: "user", content: "earlier question" }, { role: "assistant", content: "earlier answer" }], "now do this", ctx);
    expect(out.output).toContain("### user\nearlier question");
    expect(out.output).toContain("### assistant\nearlier answer");
    expect(out.output).toContain("now do this");
    expect(out.meta?.resumeMode).toBe("rendered-prefix");
    expect(renderPrefix([{ role: "tool", tool_call_id: "t1", content: "result", name: "Read" }])).toContain("### tool Read");
  });

  test("version follows agent, command and model", async () => {
    const ws = workspace();
    const a = createTarget("agent", { kind: "process", agent: "generic", workspace: ws, command: ["echo", "a"] });
    const b = createTarget("agent", { kind: "process", agent: "generic", workspace: ws, command: ["echo", "b"] });
    expect(await a.version()).not.toBe(await b.version());
    expect(await a.version()).toBe(await createTarget("agent", { kind: "process", agent: "generic", workspace: ws, command: ["echo", "a"] }).version());
  });
});

describe("claude-code stream-json parser", () => {
  test("maps assistant tool_use and user tool_result blocks, output and usage from the result record", () => {
    const text = fs.readFileSync(path.join(fixtures, "claude-stream.jsonl"), "utf8");
    const parsed = parseClaudeStream(text);
    expect(parsed.output).toBe("Created hello.txt with the greeting.");
    const roles = parsed.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "assistant", "tool", "assistant"]);
    const call = parsed.messages[1]?.tool_calls?.[0];
    expect(call).toMatchObject({ id: "toolu_1", type: "function", function: { name: "Write" } });
    expect(JSON.parse(call!.function.arguments)).toEqual({ file_path: "/app/hello.txt", content: "hi" });
    expect(parsed.messages[2]).toMatchObject({ role: "tool", tool_call_id: "toolu_1" });
    expect(parsed.usage).toEqual({ inputTokens: 1200, outputTokens: 80, costUsd: 0.0123 });
    expect(parsed.spans.filter((s) => s.kind === "tool")).toHaveLength(1);
    expect(parsed.spans[0]?.name).toBe("Write");
    expect(parsed.meta.model).toBe("claude-opus-5-5");
  });

  // Modelled on a real Claude Code 2.1.296 stream: hooks, thinking and task notices as system records,
  // one API message split over several records that repeat its usage, cache tokens, rate limit events.
  const real = (): ReturnType<typeof parseClaudeStream> => parseClaudeStream(fs.readFileSync(path.join(fixtures, "claude-stream-2.1.jsonl"), "utf8"));

  test("only the init record is a system message; hook, thinking and task records are not turns", () => {
    const parsed = real();
    expect(parsed.messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(parsed.messages.map((m) => m.role)).toEqual(["system", "assistant", "tool", "assistant", "tool", "tool", "assistant"]);
  });

  test("records that share a message id are one assistant turn with its text and all its tool calls", () => {
    const parsed = real();
    const turns = parsed.messages.filter((m) => m.role === "assistant");
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({ content: "Let me look." });
    expect(turns[0]!.tool_calls?.map((c) => c.function.name)).toEqual(["Bash"]);
    expect(turns[1]!.tool_calls?.map((c) => c.function.name)).toEqual(["Read", "Edit"]);
    expect(turns[2]).toEqual({ role: "assistant", content: "Changed a to 2." });
    expect(parsed.messages.filter((m) => m.role === "tool").map((m) => [m.name, m.tool_call_id])).toEqual([["Bash", "toolu_a"], ["Read", "toolu_b"], ["Edit", "toolu_c"]]);
    expect(parsed.spans.filter((s) => s.kind === "tool").map((s) => s.name)).toEqual(["Bash", "Read", "Edit"]);
  });

  test("input tokens include cache reads and writes: the result record's totals, with the breakdown kept in meta", () => {
    const parsed = real();
    expect(parsed.usage).toEqual({ inputTokens: 9 + 5500 + 99000, outputTokens: 410, costUsd: 0.0931 });
    expect(parsed.meta.tokens).toEqual({ input: 9, cacheCreation: 5500, cacheRead: 99000, output: 410 });
  });

  test("without a result record, usage is counted once per message id, not once per record", () => {
    const text = fs.readFileSync(path.join(fixtures, "claude-stream-2.1.jsonl"), "utf8");
    const parsed = parseClaudeStream(text.split("\n").filter((l) => !l.includes('"type": "result"')).join("\n"));
    expect(parsed.meta.tokens).toEqual({ input: 2 + 3 + 4, cacheCreation: 4000 + 1000 + 500, cacheRead: 30000 + 34000 + 35000, output: 8 + 6 + 12 });
    expect(parsed.usage.inputTokens).toBe(9 + 5500 + 99000);
    expect(parsed.output).toBe("Changed a to 2.");
  });

  test("meta records what the session loaded and the subscription utilization it last reported", () => {
    const parsed = real();
    expect(parsed.meta).toMatchObject({ sessionId: "sess-9", model: "claude-sonnet-5-5", claudeCodeVersion: "2.1.296", permissionMode: "bypassPermissions", toolCount: 3, plugins: ["ponytail", "vercel"], mcpServers: ["context7"], hooks: ["SessionStart:startup"], numTurns: 3 });
    expect(parsed.meta.rateLimit).toEqual({ status: "allowed_warning", type: "seven_day", fiveHour: 0.31, sevenDay: 0.56 });
  });
});

describe("codex exec --json parser", () => {
  test("maps agent messages and command executions", () => {
    const text = fs.readFileSync(path.join(fixtures, "codex-stream.jsonl"), "utf8");
    const parsed = parseCodexStream(text);
    expect(parsed.output).toBe("All done.");
    expect(parsed.messages.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(parsed.messages[0]?.tool_calls?.[0]?.function.name).toBe("shell");
    expect(parsed.usage).toEqual({ inputTokens: 500, outputTokens: 40, costUsd: 0 });
  });
});
