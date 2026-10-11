import { afterEach, describe, expect, test } from "bun:test";
import { createTarget } from "./index";
import type { RunContext, Target } from "./target";

const ctx: RunContext = { runId: "r", caseId: "c1", trial: 0 };
const server = ["bun", new URL("../../test/fixtures/mcp-echo.ts", import.meta.url).pathname];
const targets: Target[] = [];
function mcp(tool: string, extra: Record<string, unknown> = {}): Target {
  const t = createTarget("m", { kind: "mcp", command: server, tool, ...extra });
  targets.push(t);
  return t;
}
afterEach(async () => {
  for (const t of targets.splice(0)) await t.close?.();
});

describe("mcp target", () => {
  test("handshake then tools/call; text content is joined and JSON-parsed when possible", async () => {
    const out = await mcp("echo").run({ text: "hello" }, ctx);
    expect(out.error).toBeUndefined();
    expect(out.output).toBe("hello");
    expect(out.spans?.[0]).toMatchObject({ kind: "tool", name: "echo", input: { text: "hello" } });
    expect(out.messages?.map((m) => m.role)).toEqual(["user", "tool"]);
    const json = await mcp("echo").run({ text: '{"a":1}' }, ctx);
    expect(json.output).toEqual({ a: 1 });
  });

  test("args mapper and structuredContent", async () => {
    const out = await mcp("structured", { args: (input: unknown) => ({ wrapped: input }) }).run("x", ctx);
    expect(out.output).toEqual({ n: 1, args: { wrapped: "x" } });
  });

  test("isError results and JSON-RPC errors become TargetOutput.error", async () => {
    const failed = await mcp("fail").run({}, ctx);
    expect(failed.error).toMatch(/tool failed badly/);
    const unknown = await mcp("nope").run({}, ctx);
    expect(unknown.error).toMatch(/unknown tool nope/);
  });

  test("a crashed server is restarted on the next call", async () => {
    const t = createTarget("m", { kind: "mcp", command: server, tool: "crash" });
    targets.push(t);
    const dead = await t.run({}, ctx);
    expect(dead.error).toMatch(/exited/);
    const echo = createTarget("m", { kind: "mcp", command: server, tool: "echo" });
    targets.push(echo);
    expect((await echo.run({ text: "back" }, ctx)).output).toBe("back");
  });

  test("version includes the serverInfo and the command", async () => {
    const v = await mcp("echo").version();
    expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(v).toBe(await mcp("echo").version());
    expect(v).not.toBe(await createTarget("m", { kind: "mcp", command: [...server, "--flag"], tool: "echo" }).version());
  });

  test("a call times out and reports it", async () => {
    const t = createTarget("m", { kind: "mcp", command: ["sleep", "5"], tool: "echo", timeoutMs: 100 });
    targets.push(t);
    const out = await t.run({}, ctx);
    expect(out.error).toMatch(/timed out|exited/);
  });
});
