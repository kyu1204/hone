# setup: adding hone to a project

```bash
bunx hone-eval init     # in the project root; requires Bun >= 1.3.14
```

`init` detects what the project is and writes:

| File | What it is |
| --- | --- |
| `hone.config.ts` | the targets (the system under test), where the cases are, the scorers, the gates |
| `evals/cases.yaml` | example cases to replace with real ones |
| `sharpen/README.md` | what the `sharpen/` directory is for, with a commented change |
| `.agents/skills/hone/`, `.claude/skills/hone/` | this skill |
| `.mcp.json` (and `.cursor/mcp.json` when `.cursor/` exists) | the `hone` MCP server, merged into what is there |

`--no-agents` skips the skill and the MCP registration. Running `init` again refreshes the skill and leaves an existing config alone (`--force` overwrites it).

### An agent built with LangChain or Strands

When `pyproject.toml` or a `requirements*.txt` names `langchain`, `langgraph` or `strands-agents`, `init` also writes `hone_target.py` and points a `python` target at it:

```python
def build_agent(system_prompt: str):
    # EDIT: return your own agent, built with this system prompt
    ...

def answer(input, ctx):
    agent = build_agent(ctx.params["system_prompt"])
    result = agent.invoke({"messages": [{"role": "user", "content": input}]})
    return ctx.from_langchain(result["messages"])     # ctx.from_strands(agent.messages, usage) for Strands
```

That one function is the whole integration: `ctx.from_langchain` / `ctx.from_strands` record every tool call with its arguments, every tool result, the tokens and the cost. The system prompt comes from `params` in the config, and the config already declares it as the text `hone sharpen` may change. Edit `build_agent` and `PROMPT`, then write cases that say which tools must be called and what the answer must say (`cases`).

## The config

```ts
import { defineConfig } from "hone-eval";

export default defineConfig({
  targets: {
    rag: { kind: "http", url: "http://localhost:8000/ask", body: (c) => ({ q: c.input }), output: "answer" },
  },
  cases: "evals/**/*.yaml",
  trials: 3,
  scorers: [{ name: "contains", caseField: "expected.answer" }, { name: "rag.citations" }],
  gates: { passAt1: { min: 0.8 } },
});
```

A target is what gets evaluated. Kinds: `http` (an endpoint), `fn` (a TypeScript function in the config), `python` (a Python callable), `process` (a command-line agent such as Claude Code in an isolated copy of a workspace), `mcp` (a tool on an MCP server), `replay` (recorded traces), `docker`. Options for each are in `docs/config.md` of the package.

Point the target at the real system first and run `hone test` before writing more cases. A target that errors on every case tells you nothing about quality.

## Where a new text goes

To let a prompt, a rule file or a rubric be rewritten (by a change file or by a model), the config says how a new version of it gets into the config:

```ts
sharpen: {
  text: { seed: PROMPT, apply: (config, text) => withPrompt(config, text) },
},
```

`seed` is the text as it is now. `apply` returns the config with `text` in its place. Without this block a change can still alter the config (a setting, a model, another function); it only cannot carry a `text`.

## Keys

Keys live in `~/.config/hone/env` (mode 0600), the project `.env`, or the environment. Deterministic scorers need none. `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` lets `hone sharpen` name failure modes and write rewrites; `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` is for Jev judges. Never write a key into the config, a case or a change file.
