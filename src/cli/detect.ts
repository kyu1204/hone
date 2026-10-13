// Project detection for `hone init`: which targets, scorers and example cases make sense here.
import * as fs from "node:fs";
import * as path from "node:path";
import type { ScorerSpec } from "../core/config";
import type { Case } from "../core/types";

export interface DetectedTarget {
  id: string;
  kind: string;
  /** TypeScript source of the spec object literal, written verbatim into hone.config.ts. */
  spec: string;
}

export interface Detection {
  signals: string[];
  targets: DetectedTarget[];
  scorers: ScorerSpec[];
  cases: Case[];
  notes: string[];
  /** Extra files to write (relative path to content). */
  files: Record<string, string>;
  /** Import lines needed by the spec literals. */
  imports: string[];
  /** Declarations the spec literals use, written before the config. */
  preamble: string[];
  /** TypeScript source of the `sharpen` block, when detection knows what may change. */
  sharpen?: string;
}

const TARGET_HEAD = `"""What hone calls once per trial: build the agent, run it on the case input, hand back what it returned.

hone passes the system prompt (and whatever else is under \`params\` in hone.config.ts), which is how \`hone sharpen\`
tries a new prompt without touching your code.
"""
`;
const LANGCHAIN_TARGET = `${TARGET_HEAD}

def build_agent(system_prompt: str):
    # EDIT: return your own agent, built with this system prompt (anything with .invoke({"messages": [...]}))
    from langchain.agents import create_agent

    return create_agent(model="anthropic:claude-haiku-5-5", tools=[], system_prompt=system_prompt)


def answer(input, ctx):
    agent = build_agent(ctx.params["system_prompt"])
    result = agent.invoke({"messages": [{"role": "user", "content": input if isinstance(input, str) else str(input)}]})
    # the whole conversation: tool calls with their arguments, tool results, tokens and cost
    return ctx.from_langchain(result["messages"])
`;
const STRANDS_TARGET = `${TARGET_HEAD}

def build_agent(system_prompt: str):
    # EDIT: return your own agent, built with this system prompt (your model, your tools)
    from strands import Agent

    return Agent(system_prompt=system_prompt, callback_handler=None)


def answer(input, ctx):
    agent = build_agent(ctx.params["system_prompt"])
    result = agent(input if isinstance(input, str) else str(input))
    # the whole conversation: tool calls with their arguments, tool results and tokens; add model="<model id>" to have them priced
    return ctx.from_strands(agent.messages, result.metrics.accumulated_usage)
`;

const exists = (dir: string, f: string): boolean => fs.existsSync(path.join(dir, f));
const read = (dir: string, f: string): string => (exists(dir, f) ? fs.readFileSync(path.join(dir, f), "utf8") : "");

export function detectProject(dir: string): Detection {
  const d: Detection = { signals: [], targets: [], scorers: [], cases: [], notes: [], files: {}, imports: [], preamble: [] };
  const addScorer = (s: ScorerSpec) => {
    if (!d.scorers.some((x) => x.name === s.name)) d.scorers.push(s);
  };

  if (exists(dir, "CLAUDE.md") || exists(dir, ".claude")) {
    d.signals.push("claude-code");
    d.targets.push({ id: "claude-code", kind: "process", spec: `{ kind: "process", agent: "claude-code", workspace: ".", isolate: "copy", timeoutMs: 600_000 }` });
    d.cases.push({ id: "summarise-readme", input: "Summarise this repository's README in one sentence.", tags: ["smoke"] });
    addScorer({ name: "regex", pattern: "\\w{3,}" });
    addScorer({ name: "hack" });
    d.notes.push("claude-code target needs the `claude` CLI on PATH; each trial runs in a copy of this directory.");
  }

  const requirements = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^requirements.*\.txt$/.test(f)) : [];
  const py = [read(dir, "pyproject.toml"), ...requirements.map((f) => read(dir, f))].join("\n").toLowerCase();

  // an agent built with a framework: a python target that calls one function, and the system prompt as what may change
  const frameworks = [/\blang(chain|graph)\b/.test(py) ? "langchain" : "", /\bstrands-agents\b/.test(py) ? "strands" : ""].filter(Boolean);
  if (frameworks.length) {
    d.signals.push(...frameworks);
    const python = exists(dir, ".venv/bin/python") ? 'python: ".venv/bin/python", ' : "";
    d.preamble.push('// EDIT: the system prompt your agent runs with today. `hone sharpen` starts from it.\nconst PROMPT = "You are a helpful assistant.";');
    d.targets.push({ id: "agent", kind: "python", spec: `{ kind: "python", module: "hone_target", fn: "answer", ${python}workers: 4, timeoutMs: 180_000, params: { system_prompt: PROMPT } }` });
    d.files["hone_target.py"] = frameworks[0] === "langchain" ? LANGCHAIN_TARGET : STRANDS_TARGET;
    d.sharpen = `  // What \`hone sharpen\` may change: the system prompt. A rewrite, or a change file under sharpen/, reaches the agent through params.
  sharpen: {
    text: { seed: PROMPT, apply: (config, text) => ({ ...config, targets: { ...config.targets, agent: { ...config.targets.agent!, params: { ...(config.targets.agent!.params as object), system_prompt: text } } } }) },
  },
`;
    d.cases.push({ id: "sample", input: "What can you help me with?", tags: ["smoke"] });
    addScorer({ name: "regex", pattern: "." });
    d.notes.push("agent target: edit build_agent in hone_target.py so that it returns your agent, and put its system prompt in PROMPT. Then write cases in evals/ that say which tools must be called and what the answer must say.");
    if (frameworks.length > 1) d.notes.push("LangChain and Strands are both installed; hone_target.py is written for LangChain. For a Strands agent, return ctx.from_strands(agent.messages, result.metrics.accumulated_usage).");
  }
  if (/\b(fastapi|flask)\b/.test(py)) {
    d.signals.push("fastapi");
    d.targets.push({ id: "rag", kind: "http", spec: `{ kind: "http", url: "http://localhost:8000/ask", body: (c) => ({ question: c.input }), output: "answer" }` });
    d.cases.push({ id: "sample-question", input: "What does this service answer?", expected: { chunks: [] }, tags: ["smoke"] });
    addScorer({ name: "rag.citations" });
    addScorer({ name: "rag.faithfulness" });
    d.notes.push("rag target: return retrieved chunks as a retrieval span in a `_hone` field ({ spans: [{ kind: \"retrieval\", output: [{ id, text }] }] }) so RAG scorers can see them.");
    if (/pgvector|chromadb|qdrant|weaviate|pinecone/.test(py)) d.notes.push("vector store detected: list the chunk ids you expect under `expected.chunks` to get recall and precision.");
  }

  const mcpText = read(dir, ".mcp.json") || read(dir, "claude_desktop_config.json");
  if (mcpText) {
    try {
      const servers = (JSON.parse(mcpText) as { mcpServers?: Record<string, { command?: string; args?: string[] }> }).mcpServers ?? {};
      const stdio = Object.entries(servers).filter(([, s]) => typeof s.command === "string");
      if (stdio.length) {
        d.signals.push("mcp");
        for (const [name, s] of stdio) {
          d.targets.push({ id: `mcp-${name}`, kind: "mcp", spec: `{ kind: "mcp", command: ${JSON.stringify([s.command, ...(s.args ?? [])])}, tool: "TOOL_NAME" }` });
          d.cases.push({ id: `mcp-${name}-smoke`, input: {}, tags: ["smoke"] });
        }
        addScorer({ name: "regex", pattern: "." });
        d.notes.push("mcp targets: replace TOOL_NAME with the tool to evaluate and give each case the tool's arguments as input.");
      }
    } catch {
      d.notes.push("could not parse the MCP config; add mcp targets by hand.");
    }
  }

  const pkg = read(dir, "package.json");
  if (/"(ai|openai|@anthropic-ai\/sdk|@ai-sdk\/[a-z-]+)"\s*:/.test(pkg)) {
    d.signals.push("node-ai");
    d.imports.push(`import { handler } from "./evals/target";`);
    d.targets.push({ id: "app", kind: "fn", spec: `{ kind: "fn", fn: handler }` });
    d.files["evals/target.ts"] = `// Called once per trial. Return the answer, or { output, messages, spans, usage } for a full trace.\n// ctx.span(kind, name, fn), ctx.message(m) and ctx.usage(u) record what happened.\nexport async function handler(input: unknown, ctx: { span: <T>(kind: "llm" | "tool" | "retrieval" | "agent" | "custom", name: string, body: () => Promise<T> | T) => Promise<T> }): Promise<unknown> {\n  return ctx.span("llm", "answer", async () => \`TODO: answer ${"${"}String(input)}\`);\n}\n`;
    d.cases.push({ id: "sample", input: "What can this app do?", tags: ["smoke"] });
    addScorer({ name: "regex", pattern: "." });
  }

  if (d.targets.length === 0) {
    d.targets.push({ id: "echo", kind: "fn", spec: `{ kind: "fn", fn: (input) => input }` });
    d.cases.push({ id: "echo-smoke", input: "hello", expected: "hello", tags: ["smoke"] });
    addScorer({ name: "exact" });
    d.notes.push("nothing detected: an echo target and one exact case so `hone test` passes; replace them with your own.");
  }
  return d;
}

// Commented out so the generated file runs as written. `hone sharpen` changes only what is declared here.
const SHARPEN_HINT = `  // What \`hone sharpen\` may change. Uncomment and point it at your prompt and settings:
  // sharpen: {
  //   text: { seed: PROMPT, apply: (config, text) => ({ ...config, targets: { /* the same target with this text */ } }) },
  //   variants: { "another setting": (config) => ({ ...config, targets: { /* the same target with that setting */ } }) },
  // },
`;

export function renderConfig(d: Detection, importFrom = "hone-eval"): string {
  const targets = d.targets.map((t) => `    ${JSON.stringify(t.id)}: ${t.spec},`).join("\n");
  const notes = d.notes.map((n) => `// ${n}`).join("\n");
  const preamble = d.preamble.join("\n");
  return `import { defineConfig } from ${JSON.stringify(importFrom)};\n${d.imports.join("\n")}${d.imports.length ? "\n" : ""}\n${preamble}${preamble ? "\n\n" : ""}${notes}${notes ? "\n" : ""}export default defineConfig({\n  targets: {\n${targets}\n  },\n  cases: "evals/**/*.yaml",\n  trials: 3,\n  scorers: ${JSON.stringify(d.scorers)},\n  gates: { passAt1: { min: 0.8 } },\n${d.sharpen ?? SHARPEN_HINT}});\n`;
}

/** JSON is valid YAML; keep it readable with one case per entry. */
export function renderCases(cases: Case[]): string {
  return `${JSON.stringify(cases, null, 2)}\n`;
}
