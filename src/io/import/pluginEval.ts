// `claude plugin eval` case directories: prompt + graders/*.md -> hone cases and scorer specs.
import * as fs from "node:fs";
import * as path from "node:path";
import type { ScorerSpec } from "../../core/config";
import type { Case } from "../../core/types";

export interface Grader {
  file: string;
  type: string;
  frontmatter: Record<string, string>;
  body: string;
}

export function parseFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: text.trim() };
  const frontmatter: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) frontmatter[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { frontmatter, body: m[2]!.trim() };
}

const lines = (body: string): string[] => body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const TARGETS: Record<string, string> = { reply: "output", files: "files", trace: "messages", mock_calls: "tool_calls" };

/** One grader file -> one hone scorer spec; free graders map to deterministic kinds, llm/baseline to llm.rubric. */
export function graderToSpec(g: Grader): ScorerSpec {
  const id = path.basename(g.file, ".md");
  const weight = g.frontmatter.weight ? Number(g.frontmatter.weight) : undefined;
  const base = { id, ...(weight !== undefined && Number.isFinite(weight) ? { weight } : {}), ...(g.frontmatter.arm ? { arm: g.frontmatter.arm } : {}) };
  switch (g.type) {
    case "regex":
      return { name: "regex", ...base, pattern: g.body, target: TARGETS[g.frontmatter.target ?? "reply"] ?? g.frontmatter.target ?? "output", ...(g.frontmatter.negate === "true" ? { negate: true } : {}), ...(g.frontmatter.flags ? { flags: g.frontmatter.flags } : {}) };
    case "tool_used":
      return { name: "tool_used", ...base, tool: lines(g.body) };
    case "tool_order":
      return { name: "tool_order", ...base, tools: lines(g.body) };
    case "file_exists":
      return { name: "file_exists", ...base, path: lines(g.body) };
    case "llm":
    case "baseline":
      return { name: "llm.rubric", ...base, rubric: g.body, ...(g.type === "baseline" ? { baseline: true } : {}) };
    default:
      return { name: g.type, ...base, body: g.body };
  }
}

function readGraders(dir: string): Grader[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const { frontmatter, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), "utf8"));
      return { file: path.join(dir, f), type: frontmatter.type ?? "llm", frontmatter, body };
    });
}

const PROMPT_FILES = ["prompt.md", "input.md", "task.md", "PROMPT.md"];

function readPrompt(dir: string): string | undefined {
  for (const f of PROMPT_FILES) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  }
  return undefined;
}

/** A case directory, or a directory of case directories; shared `graders/` at the top level apply to every case. */
export function importPluginEval(dir: string): { cases: Case[]; scorers: ScorerSpec[]; graders: Record<string, Grader[]> } {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);
  const shared = readGraders(path.join(dir, "graders"));
  const own = readPrompt(dir);
  const caseDirs = own !== undefined ? [dir] : fs.readdirSync(dir).map((f) => path.join(dir, f)).filter((p) => fs.statSync(p).isDirectory() && readPrompt(p) !== undefined).sort();
  if (caseDirs.length === 0) throw new Error(`no case directory with ${PROMPT_FILES.join("|")} under ${dir}`);
  const cases: Case[] = [];
  const graders: Record<string, Grader[]> = {};
  const specs = new Map<string, ScorerSpec>();
  for (const cd of caseDirs) {
    const id = path.basename(cd);
    const gs = [...shared, ...readGraders(path.join(cd, "graders"))];
    graders[id] = gs;
    const rubric = gs.filter((g) => g.type === "llm" || g.type === "baseline").map((g) => g.body).join("\n\n");
    cases.push({ id, input: readPrompt(cd)!, tags: ["plugin-eval"], ...(rubric ? { rubric } : {}), meta: { dir: cd, graders: gs.map((g) => path.basename(g.file)) } });
    for (const g of gs) {
      const spec = graderToSpec(g);
      specs.set(String(spec.id), spec);
    }
  }
  return { cases, scorers: [...specs.values()], graders };
}
