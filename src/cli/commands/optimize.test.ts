import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { optimizeCommand } from "./optimize";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-optcmd-"));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "hone.config.ts"),
    `import { defineConfig } from ${JSON.stringify(configModule)};
export default defineConfig({
  targets: { t: { kind: "fn", fn: (i) => String(i), version: "lower" } },
  cases: Array.from({ length: 6 }, (_, i) => ({ id: "c" + i, input: "w" + i, expected: "W" + i })),
  scorers: [{ name: "exact" }],
  ${withHook ? 'sharpen: { variants: { upper: (c) => ({ ...c, targets: { t: { kind: "fn", fn: (i) => String(i).toUpperCase(), version: "upper" } } }) } },' : ""}
});
`,
  );
  return dir;
}

describe("hone optimize", () => {
  test("prints the arm table and verdict, writes .hone/optimize/<id>.json", async () => {
    const dir = project(true);
    const o = io(dir);
    expect(await optimizeCommand(["--budget", "24", "--batch", "6", "--seed", "1"], o)).toBe(0);
    expect(o.out).toMatch(/arm\s+trials\s+pass/);
    expect(o.out).toMatch(/upper\s+\d+\s+100%/);
    expect(o.out).toMatch(/upper beats baseline/);
    expect(o.out).toMatch(/\.hone\/optimize\/\d+\.json/);
    const j = io(dir);
    expect(await optimizeCommand(["--budget", "12", "--batch", "6", "--json"], j)).toBe(0);
    expect(JSON.parse(j.out).file.kind).toBe("optimize");
  });

  test("a config that declares no variants exits 2 and says which key to add", async () => {
    const o = io(project(false));
    expect(await optimizeCommand([], o)).toBe(2);
    expect(o.err).toMatch(/sharpen: \{ variants: /);
  });
});
