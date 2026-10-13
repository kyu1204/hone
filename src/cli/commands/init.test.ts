import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadCases, loadConfig } from "../../core/config";
import { loadChanges } from "../../correct/change";
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
    expect(o.out).toMatch(/next: hone test, then hone sharpen/);
    const run = io(d);
    expect(await runCommand(["--quiet"], run)).toBe(0);
    // the config shows how to tell hone what it may change, commented out so the file runs as written
    const text = fs.readFileSync(path.join(d, "hone.config.ts"), "utf8");
    expect(text).toMatch(/\/\/ sharpen: \{/);
    expect(text).toMatch(/\/\/ +text: \{ seed: /);
    expect(text).toMatch(/\/\/ +variants: \{ /);
    expect(config.sharpen).toBeUndefined();
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

  test("init wires coding agents: the skill with its references in both places, the MCP server, a sharpen/ directory", async () => {
    const d = tmp();
    const o = io(d);
    expect(await initCommand(["--yes", "--no-keys"], o)).toBe(0);
    for (const root of [".agents", ".claude"]) {
      const skill = fs.readFileSync(path.join(d, root, "skills", "hone", "SKILL.md"), "utf8");
      expect(skill).toMatch(/^---\nname: hone\n/);
      expect(fs.readFileSync(path.join(d, root, "skills", "hone", "references", "sharpening.md"), "utf8")).toMatch(/^# sharpening/);
      expect(fs.readdirSync(path.join(d, root, "skills", "hone", "references")).sort()).toEqual(["cases.md", "mcp.md", "results.md", "setup.md", "sharpening.md", "steps.md"]);
    }
    expect(JSON.parse(fs.readFileSync(path.join(d, ".mcp.json"), "utf8"))).toEqual({ mcpServers: { hone: { command: "bunx", args: ["hone-eval", "serve", "mcp"] } } });
    expect(fs.existsSync(path.join(d, ".cursor"))).toBe(false); // only when the project uses Cursor
    expect(fs.readFileSync(path.join(d, "sharpen", "README.md"), "utf8")).toContain('change("what it does"');
    expect(await loadChanges(d)).toEqual([]); // the README is not a change
    expect(o.out).toMatch(/installed the hone skill in \.agents\/skills\/hone and \.claude\/skills\/hone/);
    expect(o.out).toMatch(/registered the hone MCP server in \.mcp\.json/);
  });

  test("the registration is merged into what is there and left alone when current; the skill is refreshed", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "other-server" } }, extra: true }, null, 2));
    fs.mkdirSync(path.join(d, ".cursor"));
    expect(await initCommand(["--yes", "--no-keys"], io(d))).toBe(0);
    const first = fs.readFileSync(path.join(d, ".mcp.json"), "utf8");
    expect(JSON.parse(first)).toEqual({ mcpServers: { other: { command: "other-server" }, hone: { command: "bunx", args: ["hone-eval", "serve", "mcp"] } }, extra: true });
    expect(JSON.parse(fs.readFileSync(path.join(d, ".cursor", "mcp.json"), "utf8")).mcpServers.hone.command).toBe("bunx");
    // a registration someone adjusted is theirs: env and timeouts stay
    const mine = { mcpServers: { hone: { command: "bunx", args: ["hone-eval", "serve", "mcp"], env: { HONE_LLM_MODEL: "x" } } } };
    fs.writeFileSync(path.join(d, ".mcp.json"), JSON.stringify(mine));
    const skill = path.join(d, ".claude", "skills", "hone", "SKILL.md");
    fs.writeFileSync(skill, "stale");
    const again = io(d);
    expect(await initCommand(["--yes", "--no-keys", "--force"], again)).toBe(0);
    expect(fs.readFileSync(path.join(d, ".mcp.json"), "utf8")).toBe(JSON.stringify(mine));
    expect(fs.readFileSync(skill, "utf8")).toMatch(/^---\nname: hone\n/);
    // a file that is not JSON is not overwritten; init says how to register by hand
    fs.writeFileSync(path.join(d, ".mcp.json"), "{ not json");
    const broken = io(d);
    expect(await initCommand(["--yes", "--no-keys", "--force"], broken)).toBe(0);
    expect(fs.readFileSync(path.join(d, ".mcp.json"), "utf8")).toBe("{ not json");
    expect(broken.out).toMatch(/could not read \.mcp\.json.*claude mcp add hone -- bunx hone-eval serve mcp/);
  });

  test("--no-agents skips the skill and the registration; --skills alone installs the skill into an initialised project", async () => {
    const d = tmp();
    expect(await initCommand(["--yes", "--no-keys", "--no-agents"], io(d))).toBe(0);
    for (const f of [".agents", ".claude", ".mcp.json"]) expect(fs.existsSync(path.join(d, f))).toBe(false);
    expect(fs.existsSync(path.join(d, "sharpen", "README.md"))).toBe(true);
    const before = fs.readFileSync(path.join(d, "hone.config.ts"), "utf8");
    const o = io(d);
    expect(await initCommand(["--skills"], o)).toBe(0);
    expect(fs.existsSync(path.join(d, ".claude", "skills", "hone", "references", "setup.md"))).toBe(true);
    expect(fs.existsSync(path.join(d, ".mcp.json"))).toBe(false);
    expect(fs.readFileSync(path.join(d, "hone.config.ts"), "utf8")).toBe(before);
  });
});
