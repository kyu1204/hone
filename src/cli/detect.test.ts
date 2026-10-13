import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectProject, renderConfig } from "./detect";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const hasPython = Bun.spawnSync(["python3", "--version"]).exitCode === 0;
const configModule = new URL("../core/config.ts", import.meta.url).pathname;
function dir(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-detect-"));
  dirs.push(d);
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  return d;
}

describe("detectProject", () => {
  test("Claude Code project", () => {
    const r = detectProject(dir({ "CLAUDE.md": "# rules", "README.md": "# demo" }));
    expect(r.signals).toContain("claude-code");
    expect(r.targets.some((t) => t.kind === "process" && t.id === "claude-code")).toBe(true);
    expect(r.cases.some((c) => /readme/i.test(String(c.input)))).toBe(true);
  });

  test("FastAPI RAG project", () => {
    const r = detectProject(dir({ "pyproject.toml": "[project]\ndependencies = [\"fastapi\", \"pgvector\"]\n" }));
    expect(r.signals).toContain("fastapi");
    const http = r.targets.find((t) => t.kind === "http");
    expect(http?.id).toBe("rag");
    expect(r.scorers.map((s) => s.name)).toEqual(expect.arrayContaining(["rag.citations", "rag.faithfulness"]));
    expect(r.notes.join(" ")).toMatch(/retrieval span/);
  });

  test("MCP servers from .mcp.json", () => {
    const r = detectProject(dir({ ".mcp.json": JSON.stringify({ mcpServers: { echo: { command: "bun", args: ["server.ts"] }, remote: { url: "http://x" } } }) }));
    expect(r.signals).toContain("mcp");
    expect(r.targets.filter((t) => t.kind === "mcp").map((t) => t.id)).toEqual(["mcp-echo"]);
  });

  describe("an agent built with a framework", () => {
    const projects: [string, string, Record<string, string>][] = [
      ["langchain", "from_langchain", { "pyproject.toml": '[project]\ndependencies = ["langchain>=1.0", "langchain-anthropic"]\n' }],
      ["langchain", "from_langchain", { "requirements.txt": "langgraph==1.2.15\n" }],
      ["strands", "from_strands", { "pyproject.toml": '[project]\ndependencies = ["strands-agents[anthropic]>=1.0"]\n' }],
      ["strands", "from_strands", { "requirements-agent.txt": "boto3\nstrands-agents\n" }],
    ];
    for (const [framework, recorder, files] of projects) {
      test(`${framework}, from ${Object.keys(files)[0]}: a python target, the function it calls, and a prompt that sharpen may change`, async () => {
        const d = dir(files);
        const r = detectProject(d);
        expect(r.signals).toEqual([framework]);
        expect(r.targets).toEqual([expect.objectContaining({ id: "agent", kind: "python" })]);
        expect(r.targets[0]!.spec).toContain('module: "hone_target", fn: "answer"');
        // the function hone calls: one marked place to edit, and the framework's conversation recorded
        const wrapper = r.files["hone_target.py"]!;
        expect(wrapper).toContain(`ctx.${recorder}(`);
        expect(wrapper.match(/# EDIT/g)).toHaveLength(1);
        expect(wrapper).toContain('ctx.params["system_prompt"]');
        if (hasPython) {
          fs.writeFileSync(path.join(d, "hone_target.py"), wrapper);
          expect(Bun.spawnSync(["python3", "-m", "py_compile", path.join(d, "hone_target.py")]).exitCode).toBe(0);
        }
        // the config loads as written, and a new prompt reaches the agent through params
        fs.writeFileSync(path.join(d, "hone.config.ts"), renderConfig(r, configModule));
        type Loaded = { targets: { agent: { kind: string; params: { system_prompt: string } } }; sharpen: { text: { seed: string; apply: (c: Loaded, text: string) => Loaded } } };
        const config = ((await import(path.join(d, "hone.config.ts"))) as { default: Loaded }).default;
        expect(config.targets.agent.params.system_prompt).toBe(config.sharpen.text.seed);
        expect(config.sharpen.text.apply(config, "a better prompt").targets.agent.params.system_prompt).toBe("a better prompt");
        expect(config.targets.agent.params.system_prompt).toBe(config.sharpen.text.seed); // the original is not edited in place
        expect(r.notes.join(" ")).toMatch(/hone_target\.py/);
      });
    }

    test("the project's own virtual environment runs the agent; both frameworks at once is one target and a note", () => {
      const venv = detectProject(dir({ "requirements.txt": "langchain\n", ".venv/bin/python": "" }));
      expect(venv.targets[0]!.spec).toContain('python: ".venv/bin/python"');
      expect(detectProject(dir({ "requirements.txt": "langchain\n" })).targets[0]!.spec).not.toContain("python:");
      const both = detectProject(dir({ "requirements.txt": "langchain\nstrands-agents\n" }));
      expect(both.signals).toEqual(["langchain", "strands"]);
      expect(both.targets.filter((t) => t.kind === "python")).toHaveLength(1);
      expect(both.files["hone_target.py"]).toContain("from_langchain");
      expect(both.notes.join(" ")).toMatch(/strands/i);
    });
  });

  test("Node AI app and the empty fallback", () => {
    const node = detectProject(dir({ "package.json": JSON.stringify({ dependencies: { ai: "^7.0.0" } }) }));
    expect(node.signals).toContain("node-ai");
    expect(node.targets.some((t) => t.kind === "fn")).toBe(true);
    expect(node.files["evals/target.ts"]).toMatch(/export/);
    const empty = detectProject(dir({}));
    expect(empty.signals).toEqual([]);
    expect(empty.targets).toEqual([expect.objectContaining({ kind: "fn", id: "echo" })]);
    expect(empty.scorers.map((s) => s.name)).toEqual(["exact"]);
    expect(empty.cases).toHaveLength(1);
  });
});
