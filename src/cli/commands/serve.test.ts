import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CommandIo } from "./run";
import { serveCommand } from "./serve";

const dirs: string[] = [];
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const s of stops.splice(0)) await s();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function io(cwd: string): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env: {}, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}
function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-servecmd-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "hone.config.ts"), 'export default { targets: {}, cases: [], scorers: [{ name: "exact" }, { name: "contains", id: "has-x", text: "x" }] };\n');
  return dir;
}

describe("hone serve reward", () => {
  test("starts on the requested port, selects scorers, answers health", async () => {
    const o = io(project());
    let started: { port: number } | undefined;
    const rc = await serveCommand(["reward", "--port", "0", "--scorer", "exact"], o, { block: false, started: (stop, info) => { stops.push(stop); started = info; } });
    expect(rc).toBe(0);
    expect(started!.port).toBeGreaterThan(0);
    expect(o.out).toMatch(/reward server on http:\/\/127\.0\.0\.1:\d+/);
    const h = (await (await fetch(`http://127.0.0.1:${started!.port}/health`)).json()) as { scorers: string[] };
    expect(h.scorers).toEqual(["exact"]);
  });

  test("unknown scorer or missing config exits 2; unknown mode exits 2", async () => {
    const o = io(project());
    expect(await serveCommand(["reward", "--port", "0", "--scorer", "nope"], o, { block: false })).toBe(2);
    expect(o.err).toMatch(/scorer nope not found/);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "hone-servecmd2-"));
    dirs.push(empty);
    const o2 = io(empty);
    expect(await serveCommand(["reward", "--port", "0"], o2, { block: false })).toBe(2);
    expect(o2.err).toMatch(/hone\.config/);
    const o3 = io(empty);
    expect(await serveCommand(["bogus"], o3)).toBe(2);
    expect(o3.err).toMatch(/unknown serve mode/);
  });
});

describe("hone serve mcp", () => {
  test("answers initialize over the provided stream and exits when it ends", async () => {
    const o = io(project());
    const input = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`));
        c.close();
      },
    });
    expect(await serveCommand(["mcp"], o, { stdin: input })).toBe(0);
    const res = JSON.parse(o.out.trim()) as { id: number; result: { serverInfo: { name: string } } };
    expect(res.id).toBe(1);
    expect(res.result.serverInfo.name).toBe("hone");
    expect(await serveCommand(["mcp", "--bogus"], io(project()))).toBe(2);
  });

  test("as a child process over real stdio", async () => {
    const dir = project();
    const proc = Bun.spawn(["bun", new URL("../../cli.ts", import.meta.url).pathname, "serve", "mcp"], { cwd: dir, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    (proc.stdin as import("bun").FileSink).write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })}\n`);
    (proc.stdin as import("bun").FileSink).end();
    const out = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
    await proc.exited;
    const res = JSON.parse(out.trim()) as { id: number; result: { tools: { name: string }[] } };
    expect(res.id).toBe(7);
    expect(res.result.tools.map((t) => t.name)).toContain("hone_test");
  }, 20_000);
});
