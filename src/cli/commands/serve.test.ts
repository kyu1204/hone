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
