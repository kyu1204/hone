import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { evolveCommand } from "./evolve";
import type { CommandIo } from "./run";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function io(cwd: string): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env: {}, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}
const configModule = new URL("../../core/config.ts", import.meta.url).pathname;

function project(withHook: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-evolvecmd-"));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "hone.config.ts"),
    `import { defineConfig } from ${JSON.stringify(configModule)};
export default defineConfig({
  targets: { t: { kind: "fn", fn: (i) => String(i) } },
  cases: Array.from({ length: 6 }, (_, i) => ({ id: "c" + i, input: "w" + i, expected: "W" + i })),
  scorers: [{ name: "exact" }],
  ${withHook ? 'evolve: { seed: "Answer.", apply: (c, text) => ({ ...c, targets: { t: { kind: "fn", fn: (i) => (text.includes("UPPERCASE") ? String(i).toUpperCase() : String(i)), version: text } } }) },' : ""}
});
`,
  );
  return dir;
}

describe("hone evolve", () => {
  test("prints the candidate table and verdict, writes .hone/evolve/<id>.json", async () => {
    const dir = project(true);
    const o = io(dir);
    const chat = async (): Promise<{ text: string }> => ({ text: '{"text":"Answer in UPPERCASE.","rationale":"case"}' });
    expect(await evolveCommand(["--budget", "1", "--no-cache"], o, { chat })).toBe(0);
    expect(o.out).toMatch(/baseline\s+0%/);
    expect(o.out).toMatch(/cand-1\s+100%/);
    expect(o.out).toMatch(/cand-1 beats baseline/);
    expect(o.out).toMatch(/\.hone\/evolve\/\d+\.json/);
    expect(fs.readdirSync(path.join(dir, ".hone", "evolve")).some((f) => f.endsWith(".json"))).toBe(true);
    const j = io(dir);
    expect(await evolveCommand(["--budget", "1", "--no-cache", "--json"], j, { chat })).toBe(0);
    expect(JSON.parse(j.out).file.kind).toBe("evolve");
  });

  test("missing evolve hook exits 2", async () => {
    const o = io(project(false));
    expect(await evolveCommand([], o, { chat: async () => ({ text: "" }) })).toBe(2);
    expect(o.err).toMatch(/evolve hook/);
  });
});
