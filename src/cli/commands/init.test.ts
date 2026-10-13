import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadCases, loadConfig } from "../../core/config";
import { initCommand } from "./init";
import type { CommandIo } from "./run";
import { runCommand } from "./run";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const libraryEntry = new URL("../../index.ts", import.meta.url).pathname;
function io(cwd: string, extraEnv: Record<string, string> = {}): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env: { HOME: cwd, HONE_CONFIG_IMPORT: libraryEntry, ...extraEnv }, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-init-"));
  dirs.push(d);
  return d;
}

describe("hone init", () => {
  test("empty directory: writes a runnable config, example case and gitignore entry", async () => {
    const d = tmp();
    const o = io(d);
    expect(await initCommand(["--yes", "--no-keys"], o)).toBe(0);
    expect(fs.existsSync(path.join(d, "hone.config.ts"))).toBe(true);
    const { config } = await loadConfig(d);
    expect(Object.keys(config.targets)).toContain("echo");
    const cases = await loadCases(config.cases, d);
    expect(cases.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(d, ".gitignore"), "utf8")).toContain(".hone/");
    expect(o.out).toMatch(/hone test/);
    const run = io(d);
    expect(await runCommand(["--quiet"], run)).toBe(0);
  });

  test("refuses to overwrite without --force", async () => {
    const d = tmp();
    await initCommand(["--yes", "--no-keys"], io(d));
    const before = fs.readFileSync(path.join(d, "hone.config.ts"), "utf8");
    const o = io(d);
    expect(await initCommand(["--yes", "--no-keys"], o)).toBe(2);
    expect(o.err).toMatch(/--force/);
    expect(fs.readFileSync(path.join(d, "hone.config.ts"), "utf8")).toBe(before);
    expect(await initCommand(["--yes", "--no-keys", "--force"], io(d))).toBe(0);
  });

  test("detected Claude Code project gets a process target and the import comes from hone-eval", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "CLAUDE.md"), "# rules\n");
    fs.writeFileSync(path.join(d, "README.md"), "# demo\n");
    const o = io(d);
    delete o.env.HONE_CONFIG_IMPORT;
    await initCommand(["--yes", "--no-keys"], o);
    const text = fs.readFileSync(path.join(d, "hone.config.ts"), "utf8");
    expect(text).toContain('from "hone-eval"');
    expect(text).toContain('kind: "process"');
    expect(text).toContain('agent: "claude-code"');
    expect(fs.existsSync(path.join(d, "evals"))).toBe(true);
  });

  test("keys are written to ~/.config/hone/env with mode 600 when provided non-interactively", async () => {
    const d = tmp();
    const o = io(d);
    expect(await initCommand(["--yes", "--typesafe-key", "ts-test-key", "--anthropic-key", "sk-ant-test"], o)).toBe(0);
    const envFile = path.join(d, ".config", "hone", "env");
    expect(fs.readFileSync(envFile, "utf8")).toContain("TYPESAFE_API_KEY=ts-test-key");
    expect(fs.readFileSync(envFile, "utf8")).toContain("ANTHROPIC_API_KEY=sk-ant-test");
    expect((fs.statSync(envFile).mode & 0o777).toString(8)).toBe("600");
  });

  test("--skills installs the hone skill for Claude Code (and Codex when .codex exists), never overwriting without --force", async () => {
    const d = tmp();
    const o = io(d);
    expect(await initCommand(["--yes", "--no-keys", "--skills"], o)).toBe(0);
    const file = path.join(d, ".claude", "skills", "hone", "SKILL.md");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toMatch(/^---\nname: hone\n/);
    expect(text).toContain("hone serve mcp");
    expect(o.out).toMatch(/installed skill .*\.claude\/skills\/hone\/SKILL\.md/);
    expect(fs.existsSync(path.join(d, ".codex"))).toBe(false);
    fs.writeFileSync(file, "custom");
    fs.mkdirSync(path.join(d, ".codex"));
    const o2 = io(d);
    expect(await initCommand(["--yes", "--no-keys", "--skills", "--force"], o2)).toBe(0);
    expect(fs.readFileSync(file, "utf8")).not.toBe("custom");
    expect(fs.existsSync(path.join(d, ".codex", "skills", "hone", "SKILL.md"))).toBe(true);
    fs.writeFileSync(file, "custom");
    const o3 = io(d);
    expect(await initCommand(["--skills"], o3)).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe("custom");
    expect(o3.out).toMatch(/kept existing/);
    expect(fs.existsSync(path.join(d, "hone.config.ts"))).toBe(true);
  });
});
