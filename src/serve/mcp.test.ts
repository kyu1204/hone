import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../test/fixtures/trace.valid.json";
import { Store } from "../core/store";
import type { ChatMessage, Trace, Trial } from "../core/types";
import { createMcpServer, MCP_PROTOCOL_VERSION, type McpServer, serveStdio } from "./mcp";

const base = valid as Trace;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function project(): { dir: string; runId: string; failedId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-mcp-"));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "hone.config.ts"),
    'export default { targets: { t: { kind: "fn", fn: (_i: unknown, ctx: { prefix?: { content: unknown }[] }) => "answer from " + String(ctx.prefix?.at(-1)?.content ?? "fresh") } }, cases: [{ id: "c", input: "question" }, { id: "d", input: "q2" }], scorers: [{ name: "contains", text: "right document" }] };\n',
  );
  const store = new Store(path.join(dir, ".hone"));
  const run = store.createRun({ configHash: "h", targets: ["t"], caseIds: ["c", "d"] });
  const messages: ChatMessage[] = [{ role: "user", content: "question" }, { role: "assistant", content: "", tool_calls: [{ id: "x", type: "function", function: { name: "search", arguments: "{}" } }] }, { role: "tool", tool_call_id: "x", name: "search", content: "wrong document" }, { role: "assistant", content: "wrong answer" }];
  const failed: Trial = { id: Store.trialId(run.id, "c", "t", 0), runId: run.id, trace: { ...base, id: "f", caseId: "c", targetId: "t", trial: 0, messages, spans: [] }, scores: [{ scorer: "contains", value: 0, pass: false, reason: "missing" }], flags: [], pass: false, costUsd: 0.1 };
  store.saveTrial(failed);
  store.saveTrial({ id: Store.trialId(run.id, "d", "t", 0), runId: run.id, trace: { ...base, id: "p", caseId: "d", targetId: "t", trial: 0 }, scores: [{ scorer: "contains", value: 1, pass: true }], flags: [], pass: true, costUsd: 0.1 });
  store.finishRun(run.id, { totals: { passAt1: 0.5 } });
  store.close();
  return { dir, runId: run.id, failedId: failed.id };
}

const rpc = (id: number, method: string, params?: unknown): string => JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
async function call(server: McpServer, id: number, method: string, params?: unknown): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }> {
  return JSON.parse((await server.handle(rpc(id, method, params)))!) as never;
}
const text = (r: { result?: Record<string, unknown> }): string => (r.result!.content as { text: string }[])[0]!.text;

describe("mcp server", () => {
  test("initialize, ping, tools/list, notifications and unknown methods", async () => {
    const { dir } = project();
    const server = createMcpServer({ cwd: dir, env: {} });
    const init = await call(server, 1, "initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "0" } });
    expect(init.result).toMatchObject({ protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "hone" } });
    expect(await server.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).toBeUndefined();
    expect((await call(server, 2, "ping")).result).toEqual({});
    const tools = (await call(server, 3, "tools/list")).result!.tools as { name: string; inputSchema: { type: string } }[];
    expect(tools.map((t) => t.name)).toEqual(["hone_test", "hone_sharpen", "hone_guide", "hone_list_runs", "hone_matrix", "hone_compare", "hone_explain", "hone_cluster", "hone_fork"]);
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect((await call(server, 4, "nope")).error!.code).toBe(-32601);
    expect(JSON.parse((await server.handle("{broken"))!).error.code).toBe(-32700);
    expect(await server.handle("")).toBeUndefined();
  });

  test("tools read the store: list_runs, explain with fork candidates, cluster, matrix", async () => {
    const { dir, runId, failedId } = project();
    const server = createMcpServer({ cwd: dir, env: {} });
    const runs = JSON.parse(text(await call(server, 1, "tools/call", { name: "hone_list_runs", arguments: {} }))) as { id: string }[];
    expect(runs[0]!.id).toBe(runId);
    const explained = JSON.parse(text(await call(server, 2, "tools/call", { name: "hone_explain", arguments: { trialId: failedId } }))) as { pass: boolean; forkCandidates: { step: number }[] };
    expect(explained.pass).toBe(false);
    expect(explained.forkCandidates[0]!.step).toBe(1);
    const clusters = JSON.parse(text(await call(server, 3, "tools/call", { name: "hone_cluster", arguments: { run: runId } }))) as { runId: string; codes: unknown[] };
    expect(clusters.runId).toBe(runId);
    expect(clusters.codes).toHaveLength(1);
    const matrix = await call(server, 4, "tools/call", { name: "hone_matrix", arguments: {} });
    expect(matrix.result!.isError).toBeUndefined();
    expect(text(matrix)).toContain("t");
  });

  test("hone_guide returns the skill or a topic; hone_sharpen runs the cycle and returns the result document", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-mcp-sharpen-"));
    dirs.push(dir);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "hone-mcp-home-")); // no key may be found: a test must not call a real model
    dirs.push(home);
    const configModule = new URL("../core/config.ts", import.meta.url).pathname;
    const changeModule = new URL("../correct/change.ts", import.meta.url).pathname;
    fs.writeFileSync(
      path.join(dir, "hone.config.ts"),
      `import { defineConfig } from ${JSON.stringify(configModule)};
const make = (text) => ({ t: { kind: "fn", version: text, fn: (i) => (text.includes("UPPERCASE") ? String(i).toUpperCase() : String(i)) } });
export default defineConfig({ targets: make("Answer."), cases: Array.from({ length: 30 }, (_, i) => ({ id: "c" + i, input: "w" + i, expected: "W" + i })), trials: 1, scorers: [{ name: "exact" }], sharpen: { text: { seed: "Answer.", apply: (c, text) => ({ ...c, targets: make(text) }) } } });
`,
    );
    fs.mkdirSync(path.join(dir, "sharpen"));
    fs.writeFileSync(path.join(dir, "sharpen", "uppercase.ts"), `import { change } from ${JSON.stringify(changeModule)};\nchange("uppercase", { why: "outputs were lowercase", text: "Answer in UPPERCASE." });\n`);
    const server = createMcpServer({ cwd: dir, env: { HOME: home } });
    const guide = text(await call(server, 1, "tools/call", { name: "hone_guide", arguments: {} }));
    expect(guide).toMatch(/^---\nname: hone\n/);
    expect(text(await call(server, 2, "tools/call", { name: "hone_guide", arguments: { topic: "sharpening" } }))).toMatch(/^# sharpening/);
    const unknown = await call(server, 3, "tools/call", { name: "hone_guide", arguments: { topic: "nope" } });
    expect(unknown.result!.isError).toBe(true);
    const diagnosed = JSON.parse(text(await call(server, 4, "tools/call", { name: "hone_sharpen", arguments: { budget: 0 } }))) as { candidates: unknown[]; diagnosisPath: string };
    expect(diagnosed.candidates).toEqual([]);
    expect(fs.existsSync(diagnosed.diagnosisPath)).toBe(true);
    const result = JSON.parse(text(await call(server, 5, "tools/call", { name: "hone_sharpen", arguments: {} }))) as { verdict: string; message: string; candidates: { id: string; source: string }[] };
    expect(result.verdict).toBe("proven");
    expect(result.candidates[0]).toMatchObject({ id: "uppercase", source: "file" });
    expect(result.message).toMatch(/Result: PROVEN\./);
    const own = JSON.parse(text(await call(server, 6, "tools/call", { name: "hone_sharpen", arguments: { rewrites: false } }))) as { message: string };
    expect(own.message).toMatch(/Rewrites by a model were off/);
    // a server started for a client that does the proposing: the client cannot turn rewrites back on
    const judgeOnly = createMcpServer({ cwd: dir, env: { HOME: home }, rewrites: false });
    const judged = JSON.parse(text(await call(judgeOnly, 7, "tools/call", { name: "hone_sharpen", arguments: { rewrites: true } }))) as { message: string };
    expect(judged.message).toMatch(/Rewrites by a model were off/);
  });

  test("fork re-runs through the config; bad arguments and unknown trials are tool errors, not protocol errors", async () => {
    const { dir, failedId } = project();
    const server = createMcpServer({ cwd: dir, env: {} });
    const forked = await call(server, 1, "tools/call", { name: "hone_fork", arguments: { trialId: failedId, step: 2, content: "right document" } });
    expect(forked.result!.isError).toBeUndefined();
    expect((JSON.parse(text(forked)) as { forked: { pass: boolean } }).forked.pass).toBe(true);
    const bad = await call(server, 2, "tools/call", { name: "hone_explain", arguments: { trialId: "nope" } });
    expect(bad.result!.isError).toBe(true);
    expect(text(bad)).toMatch(/not found/);
    const missing = await call(server, 3, "tools/call", { name: "hone_fork", arguments: { trialId: failedId } });
    expect(missing.result!.isError).toBe(true);
    expect((await call(server, 4, "tools/call", { name: "hone_nope", arguments: {} })).error!.code).toBe(-32602);
  });

  test("serveStdio frames newline-delimited requests and answers in order", async () => {
    const { dir } = project();
    const server = createMcpServer({ cwd: dir, env: {} });
    const input = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode(`${rpc(1, "ping")}\n${rpc(2, "tools/list")}\n`));
        c.enqueue(enc.encode(rpc(3, "ping")));
        c.close();
      },
    });
    const out: string[] = [];
    await serveStdio(server, input, (l) => out.push(l));
    expect(out).toHaveLength(3);
    expect(out.map((l) => (JSON.parse(l) as { id: number }).id)).toEqual([1, 2, 3]);
  });
});
