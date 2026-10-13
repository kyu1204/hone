# Configuration

`hone.config.ts` is a TypeScript module whose default export is a `HoneConfig`. `defineConfig` only adds types. `hone init` writes a starting point from what it detects in the directory: a Claude Code project, a FastAPI or Flask service, MCP servers, a Node AI app, or an agent built with LangChain or Strands (a `python` target, the function it calls in `hone_target.py`, and the system prompt declared as what `hone sharpen` may change).

```ts
import { defineConfig } from "hone-eval";

export default defineConfig({
  targets: { rag: { kind: "http", url: "http://localhost:8000/ask" } },
  cases: "evals/**/*.yaml",
  trials: 3,
  scorers: [{ name: "exact" }, { name: "rag.citations" }],
  gates: { passAt1: { min: 0.8 } },
});
```

## Fields

| field | meaning |
|---|---|
| `targets` | named systems under test; see kinds below |
| `cases` | a glob, a list of files, or inline `Case[]` (`id`, `input`, `expected?`, `rubric?`, `tags?`, `cluster?`, `meta?`) |
| `trials` | trials per (case, target) cell; default 3 |
| `adaptive` | `{ ciWidth, maxTrials }`: keep sampling a cell until its Wilson interval is narrower than `ciWidth` |
| `scorers` | ordered list of scorer specs (`{ name, ...options }`); every scorer runs on every trial |
| `gates` | thresholds `hone test` and `hone test --ci` enforce: `passAt1 {min}`, `passHatK {k, min}`, `costUsd {max}`, `rewardHack: "fail" | "flag"` |
| `concurrency` | parallel trials; default 4 |
| `cacheDir` | store root; default `.hone` |
| `ablations` | `{ name: (config) => config }` transforms measured by `hone ablate` |
| `sharpen.text` | `{ seed, apply }`: one text hone may rewrite (a prompt, a rule file, a rubric) and how it enters the config |
| `sharpen.changes` | where the change files are: a glob or a list of globs (default every `.ts`, `.js` and `.mjs` file under `sharpen/`); see [correction](./correction.md) |
| `sharpen.variants` | `{ name: (config) => config }`: named alternative configs hone may try (a setting, a model, a retrieval depth) |

## Target kinds

| kind | runs | notes |
|---|---|---|
| `http` | POST to `url` with `body(case)`; `output` picked by `select` | timeouts, headers, retries |
| `fn` | a function `(input, ctx) => output` in the config | `ctx.span`, `ctx.message`, `ctx.usage` record the trace; `ctx.prefix` carries forks |
| `python` | a Python callable `fn(input, ctx)` via the embedded bridge | `module` (a name importable from `cwd`, or a path to a file, which then finds the files next to it; `PYTHONPATH` counts), `fn`, `python` (the interpreter, e.g. `.venv/bin/python`), `params` (handed to the callable as `ctx.params`: what a change alters), `workers` (calls served at once), `env`, `version` (what the cache keys on; by default a hash of the Python files under `cwd`, virtual environments and hidden directories left out, so editing the agent or a file it imports runs it again), `stderr: "inherit"` (show what the module prints and logs as it runs; by default it stays out of hone's output and the last of it comes with the error when the process dies or a call times out). `ctx.from_langchain(messages)` and `ctx.from_strands(messages, usage)` record an agent's whole conversation, tool calls included |
| `process` | a CLI agent in an isolated workspace | `agent: claude-code | codex | opencode | aider | generic`; parses the agent's JSON stream |
| `mcp` | `tools/call` against a stdio MCP server | own JSON-RPC client |
| `replay` | stored traces | re-score without re-running |
| `docker` | a Harbor task directory | reward from `/logs/verifier` |

Targets may implement `resume(prefix, input, ctx)`; `hone fork` uses it to re-run from an edited message.

## Scorers

Deterministic (no API): `exact`, `contains`, `regex`, `json-schema`, `tool_used`, `tool_order`, `step_count`, `cost`, `latency`, `file_exists`, `test_command`, `hack` (reward-hack heuristics on diffs).
RAG: `rag.recall`, `rag.precision`, `rag.citations`, `rag.faithfulness`, `rag.answer_relevance` (read retrieval spans).
Judges: `jev.noul`, `jev.score`, `jev.choice`, `jev.steps` (Jev System One), `llm.rubric`, `llm.pairwise` (any chat model).
Consistency: `consistency` re-runs the target on metamorphic mutations of the input.

Every scorer returns `{ value: 0..1, pass: true | false | null, reason?, evidence? }`. A trial passes when no scorer fails and at least one passes; `null` means undecided.

## Keys

`~/.config/hone/env` (mode 0600), the project `.env`, or the environment: `TYPESAFE_API_KEY` (Jev), `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (LLM judges, embeddings). `hone init` asks for them; deterministic scorers need none.
