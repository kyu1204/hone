# Configuration

`hone.config.ts` is a TypeScript module whose default export is a `HoneConfig`. `defineConfig` only adds types. `hone init` writes a starting point from what it detects in the directory.

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
| `evolve` | `{ seed, apply }`: the text `hone evolve` rewrites and how it enters the config |
| `optimize` | `{ name: (config) => config }` candidates `hone optimize` allocates trials across |

## Target kinds

| kind | runs | notes |
|---|---|---|
| `http` | POST to `url` with `body(case)`; `output` picked by `select` | timeouts, headers, retries |
| `fn` | a function `(input, ctx) => output` in the config | `ctx.span`, `ctx.message`, `ctx.usage` record the trace; `ctx.prefix` carries forks |
| `python` | a Python callable via the embedded bridge | `module:function`, own interpreter |
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
