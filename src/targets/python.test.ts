import { afterAll, afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createTarget } from "./index";
import type { RunContext, Target } from "./target";

const hasPython = Bun.spawnSync(["python3", "--version"]).exitCode === 0;
const ctx: RunContext = { runId: "r", caseId: "c1", trial: 0 };

const dirs: string[] = [];
const targets: Target[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-py-"));
  dirs.push(d);
  return d;
}
function handler(src: string): string {
  const d = tmp();
  const file = path.join(d, "handler.py");
  fs.writeFileSync(file, src);
  return file;
}
function target(module: string, fn = "handler"): Target {
  const t = createTarget("py", { kind: "python", module, fn });
  targets.push(t);
  return t;
}
afterEach(async () => {
  for (const t of targets.splice(0)) await t.close?.();
});
afterAll(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!hasPython)("python target", () => {
  test("a module name resolves from cwd even though the bridge runs with -I", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-pymod-"));
    dirs.push(d);
    fs.writeFileSync(path.join(d, "answer.py"), "def answer(input, ctx=None):\n    return 'Paris' if 'france' in str(input) else 'unknown'\n");
    const t = createTarget("py", { kind: "python", module: "answer", fn: "answer", cwd: d });
    targets.push(t);
    const out = await t.run("capital of france?", { runId: "r", caseId: "c", trial: 0 });
    expect(out.error).toBeUndefined();
    expect(out.output).toBe("Paris");
  });

  test("sync handler: plain return, spans, messages, usage", async () => {
    const file = handler(`
def handler(input, ctx):
    with ctx.span("retrieval", "search") as s:
        s.set_input({"q": input})
        s.attr("top_k", 2)
        docs = ["d1", "d2"]
        s.set_output(docs)
    ctx.message("user", input)
    ctx.message("assistant", "answer", name="bot")
    ctx.usage(input_tokens=7, output_tokens=3, cost_usd=0.001)
    ctx.usage(input_tokens=1)
    return f"{input}:{ctx.case_id}:{ctx.trial}:{len(docs)}"
`);
    const out = await target(file).run("q", ctx);
    expect(out.error).toBeUndefined();
    expect(out.output).toBe("q:c1:0:2");
    expect(out.spans?.[0]).toMatchObject({ kind: "retrieval", name: "search", input: { q: "q" }, output: ["d1", "d2"], attrs: { top_k: 2 } });
    expect(out.messages).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "answer", name: "bot" },
    ]);
    expect(out.usage).toEqual({ inputTokens: 8, outputTokens: 3, costUsd: 0.001 });
  });

  test("async handler and a returned dict with output are merged", async () => {
    const file = handler(`
import asyncio
async def handler(input, ctx):
    await asyncio.sleep(0)
    with ctx.span("llm", "chat"):
        pass
    return {"output": {"answer": 42}, "usage": {"inputTokens": 1}, "artifacts": {"stdout": "x"}}
`);
    const out = await target(file).run("q", ctx);
    expect(out.output).toEqual({ answer: 42 });
    expect(out.spans).toHaveLength(1);
    expect(out.usage).toEqual({ inputTokens: 1 });
    expect(out.artifacts).toEqual({ stdout: "x" });
  });

  test("exceptions map to error with type and traceback; the process survives", async () => {
    const file = handler(`
def handler(input, ctx):
    if input == "bad":
        raise ValueError("nope")
    return "ok"
`);
    const t = target(file);
    const bad = await t.run("bad", ctx);
    expect(bad.output).toBeNull();
    expect(bad.error).toMatch(/ValueError: nope/);
    expect(bad.meta?.traceback).toMatch(/handler\.py/);
    expect((await t.run("good", ctx)).output).toBe("ok");
  });

  test("a crashed process is restarted on the next call", async () => {
    const file = handler(`
import os
def handler(input, ctx):
    if input == "die":
        os._exit(1)
    return os.getpid()
`);
    const t = target(file);
    const pid1 = (await t.run("hi", ctx)).output;
    const dead = await t.run("die", ctx);
    expect(dead.error).toMatch(/exited/);
    const pid2 = (await t.run("hi", ctx)).output;
    expect(pid2).not.toBe(pid1);
  });

  test("prefix is forwarded and version follows the module file", async () => {
    const file = handler(`
def handler(input, ctx):
    return len(ctx.prefix or [])
`);
    const t = target(file);
    expect((await t.resume!([{ role: "user", content: "a" }, { role: "assistant", content: "b" }], "x", ctx)).output).toBe(2);
    const v1 = await t.version();
    fs.appendFileSync(file, "\n# changed\n");
    expect(await t.version()).not.toBe(v1);
  });

  test("a module that fails to import reports the error", async () => {
    const file = handler("import nonexistent_module_xyz\n");
    const out = await target(file).run("q", ctx);
    expect(out.error).toMatch(/nonexistent_module_xyz/);
  });

  test("params reach the handler as ctx.params and are part of the version", async () => {
    const file = handler("def handler(input, ctx):\n    return f\"{ctx.params.get('prompt')}|{ctx.params.get('top_k')}\"\n");
    const a = createTarget("py", { kind: "python", module: file, params: { prompt: "be brief", top_k: 5 } });
    const b = createTarget("py", { kind: "python", module: file, params: { prompt: "be brief", top_k: 30 } });
    const c = createTarget("py", { kind: "python", module: file, params: { prompt: "be brief", top_k: 5 }, env: { MODE: "x" } });
    const none = createTarget("py", { kind: "python", module: file });
    targets.push(a, b, c, none);
    expect((await a.run("q", ctx)).output).toBe("be brief|5");
    expect((await b.run("q", ctx)).output).toBe("be brief|30");
    expect((await none.run("q", ctx)).output).toBe("None|None");
    // two variants of one module must not share cached outputs
    const versions = await Promise.all([a, b, c, none].map((t) => t.version()));
    expect(new Set(versions).size).toBe(4);
    expect(await createTarget("py", { kind: "python", module: file, params: { top_k: 5, prompt: "be brief" } }).version()).toBe(versions[0]!); // key order does not matter
  });

  test("ctx.from_langchain records messages, tool calls, tool results and usage from LangChain message objects", async () => {
    const file = handler(`
class Msg:
    def __init__(self, type, content, **kw):
        self.type = type
        self.content = content
        for k, v in kw.items():
            setattr(self, k, v)

def handler(input, ctx):
    messages = [
        Msg("system", "You are the helpdesk."),
        Msg("human", input),
        Msg("ai", [{"type": "text", "text": "Let me check."}, {"type": "tool_use", "id": "t1", "name": "search_policy", "input": {"query": "vacation"}}],
            tool_calls=[{"name": "search_policy", "args": {"query": "vacation"}, "id": "t1"}],
            usage_metadata={"input_tokens": 100, "output_tokens": 20}, response_metadata={"model_name": "claude-haiku-5-5"}),
        Msg("tool", "P-03: 15 days", tool_call_id="t1", name="search_policy"),
        Msg("ai", "You get 15 days [P-03].", tool_calls=[], usage_metadata={"input_tokens": 150, "output_tokens": 12}),
    ]
    return ctx.from_langchain(messages)
`);
    const out = await target(file).run("How many vacation days?", ctx);
    expect(out.error).toBeUndefined();
    expect(out.output).toBe("You get 15 days [P-03].");
    expect(out.messages).toEqual([
      { role: "system", content: "You are the helpdesk." },
      { role: "user", content: "How many vacation days?" },
      { role: "assistant", content: "Let me check.", tool_calls: [{ id: "t1", type: "function", function: { name: "search_policy", arguments: '{"query": "vacation"}' } }] },
      { role: "tool", content: "P-03: 15 days", tool_call_id: "t1", name: "search_policy" },
      { role: "assistant", content: "You get 15 days [P-03]." },
    ]);
    expect(out.usage).toMatchObject({ inputTokens: 250, outputTokens: 32 });
    expect(out.usage!.costUsd).toBeCloseTo((250 * 1 + 32 * 5) / 1e6, 9); // priced from the table: the handler gave a model, not a cost
    expect(out.meta).toMatchObject({ model: "claude-haiku-5-5" });
  });

  test("ctx.from_strands records Bedrock-style content blocks and accumulated usage", async () => {
    const file = handler(`
def handler(input, ctx):
    messages = [
        {"role": "user", "content": [{"text": input}]},
        {"role": "assistant", "content": [{"text": "Checking."}, {"toolUse": {"toolUseId": "u1", "name": "verify_identity", "input": {"email": "a@x.io", "employee_id": "E1"}}}]},
        {"role": "user", "content": [{"toolResult": {"toolUseId": "u1", "status": "success", "content": [{"text": "verified"}]}}]},
        {"role": "assistant", "content": [{"toolUse": {"toolUseId": "u2", "name": "reset_password", "input": {"email": "a@x.io"}}}]},
        {"role": "user", "content": [{"toolResult": {"toolUseId": "u2", "status": "success", "content": [{"json": {"ok": True}}]}}]},
        {"role": "assistant", "content": [{"text": "Your password is reset."}]},
    ]
    return ctx.from_strands(messages, {"inputTokens": 300, "outputTokens": 40}, model="claude-haiku-5-5")
`);
    const out = await target(file).run("reset my password", ctx);
    expect(out.error).toBeUndefined();
    expect(out.output).toBe("Your password is reset.");
    expect(out.messages!.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);
    expect(out.messages![1]).toEqual({ role: "assistant", content: "Checking.", tool_calls: [{ id: "u1", type: "function", function: { name: "verify_identity", arguments: '{"email": "a@x.io", "employee_id": "E1"}' } }] });
    expect(out.messages![2]).toEqual({ role: "tool", content: "verified", tool_call_id: "u1", name: "verify_identity" });
    expect(out.messages![4]).toEqual({ role: "tool", content: '{"ok": true}', tool_call_id: "u2", name: "reset_password" });
    expect(out.usage).toMatchObject({ inputTokens: 300, outputTokens: 40 });
    expect(out.usage!.costUsd).toBeGreaterThan(0);
  });

  test("a finished call leaves no timer behind: a script that used a target ends when it is done", () => {
    const file = handler("def handler(input, ctx):\n    return 'ok'\n");
    const script = `
import { createTarget } from "./src/targets/index.ts";
const t = createTarget("py", { kind: "python", module: ${JSON.stringify(file)} });
console.log((await t.run("q", { runId: "r", caseId: "c", trial: 0 })).output);
await t.close?.();`;
    const started = Date.now();
    const r = Bun.spawnSync(["bun", "-e", script], { cwd: path.resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe", timeout: 10_000 });
    expect(r.stdout.toString().trim()).toBe("ok");
    expect(Date.now() - started).toBeLessThan(5_000); // the call's own timeout is two minutes
  }, 15_000);

  test("workers: several calls are served at once and each answer goes to its own request", async () => {
    const file = handler("import time\n\ndef handler(input, ctx):\n    time.sleep(0.4)\n    return f'{input}:{ctx.case_id}'\n");
    const t = createTarget("py", { kind: "python", module: file, workers: 4 });
    targets.push(t);
    await t.run("warm", ctx); // the interpreter is up
    const started = Date.now();
    const outs = await Promise.all(["a", "b", "c", "d"].map((x) => t.run(x, { runId: "r", caseId: `case-${x}`, trial: 0 })));
    expect(outs.map((o) => o.output)).toEqual(["a:case-a", "b:case-b", "c:case-c", "d:case-d"]);
    expect(Date.now() - started).toBeLessThan(1200); // four 0.4 s calls one after the other would take 1.6 s
  });
});
