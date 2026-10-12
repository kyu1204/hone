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
});
