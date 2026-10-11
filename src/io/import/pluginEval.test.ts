import { describe, expect, test } from "bun:test";
import { graderToSpec, importPluginEval, parseFrontmatter } from "./pluginEval";

const dir = new URL("../../../test/fixtures/import/plugin-eval", import.meta.url).pathname;

describe("plugin-eval import", () => {
  test("frontmatter parsing", () => {
    expect(parseFrontmatter("---\ntype: regex\nweight: 2\n---\nbody\nmore")).toEqual({ frontmatter: { type: "regex", weight: "2" }, body: "body\nmore" });
    expect(parseFrontmatter("just body")).toEqual({ frontmatter: {}, body: "just body" });
  });
  test("graders map to scorer specs", () => {
    expect(graderToSpec({ file: "g/no-skip.md", type: "regex", frontmatter: { target: "files", weight: "2", negate: "true" }, body: "\\.skip\\(" })).toEqual({ name: "regex", id: "no-skip", weight: 2, pattern: "\\.skip\\(", target: "files", negate: true });
    expect(graderToSpec({ file: "g/q.md", type: "llm", frontmatter: {}, body: "Be honest." })).toEqual({ name: "llm.rubric", id: "q", rubric: "Be honest." });
    expect(graderToSpec({ file: "g/o.md", type: "tool_order", frontmatter: {}, body: "Edit\nBash" })).toEqual({ name: "tool_order", id: "o", tools: ["Edit", "Bash"] });
  });
  test("a directory of cases with shared graders", () => {
    const r = importPluginEval(dir);
    expect(r.cases).toHaveLength(1);
    expect(r.cases[0]).toMatchObject({ id: "fix-auth", input: "Fix the flaky auth test without skipping it.", tags: ["plugin-eval"] });
    expect(r.cases[0]!.rubric).toContain("root cause");
    expect(r.scorers.map((s) => s.name).sort()).toEqual(["file_exists", "llm.rubric", "regex", "tool_order", "tool_used"]);
    expect(r.scorers.find((s) => s.name === "file_exists")).toMatchObject({ id: "report", path: ["REPORT.md"] });
    expect(r.scorers.find((s) => s.name === "tool_used")).toMatchObject({ tool: ["Bash"] });
    expect(r.graders["fix-auth"]).toHaveLength(5);
    expect(importPluginEval(`${dir}/fix-auth`).cases[0]!.id).toBe("fix-auth");
    expect(() => importPluginEval(`${dir}/nope`)).toThrow(/not a directory/);
  });
});
