import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectProject } from "./detect";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
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
