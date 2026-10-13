# Changelog

All notable changes to hone are recorded here. The format follows Keep a Changelog; versions follow semver.

## 0.1.0 (2026-10-12)

First release. Everything below landed as reviewed pull requests #1 to #80 on https://github.com/kyu1204/hone; each task has a work order under `docs/work-orders/`.

### Core
- Data model: Target, Case, Trial, Trace (OpenAI/Docent-compatible messages plus spans), Score, Verdict; JSON store under `.hone/` with a rebuildable SQLite index; content-addressed caching of target outputs and judge results.
- Config as TypeScript (`hone.config.ts`), YAML/JSON/JSONL cases, gates, ablations, and a `sharpen` block (`text`, `variants`) that says what hone may change.

### Targets
- `http`, `fn`, `python` (embedded bridge), `process` (Claude Code, Codex, OpenCode, Aider, generic, with workspace isolation and stream parsers), `mcp` (own JSON-RPC client), `replay`, `docker` (Harbor task directories, ATIF trajectories); `resume(prefix)` for forks.

### Scorers
- Deterministic: exact, contains, regex, json-schema, tool_used, tool_order, step_count, cost, latency, file_exists, test_command; `hack` reward-hack detector on diffs.
- RAG: context recall/precision, citations, faithfulness, answer relevance over retrieval spans.
- Judges: Jev System One (noul, score, choice, per-step), LLM rubric and pairwise with order swap; consistency over metamorphic mutations.

### Statistics
- Wilson/CLT/bootstrap intervals, pass@k and pass^k, paired t with exact McNemar, cluster-robust errors, Holm-adjusted leaderboard bands, noncentral-t power, sequential stopping, 2PL IRT, Thompson sampling. Test vectors from errorbars/scipy/statsmodels.

### Commands
- Three everyday commands: `init`, `test` (with `--ci` for gates, JUnit and a PR comment, `--report` for HTML) and `sharpen`. `hone help all` lists the rest in three groups.
- Changes are files: `change(name, { why, add, text, config })` under `sharpen/`, written by a person or a coding agent. `add` is one paragraph for the text as it is, and the additions that help are stacked into one text; `text` is the whole new text. A model's winning rewrite and a winning stack are saved in the same form.
- `sharpen` runs the whole cycle: a seeded held-out split that keeps declared clusters together, gates, failure diagnosis, variants and rewrites (each from the best candidate so far, variants retried on a winning rewrite), a sample check before a full run, a ledger of every attempt, and a confirmation on held-out cases that needs both a paired t test and an exact sign test, at a level divided by the number of different winners those cases have already judged.
- Single steps and tools: `matrix`, `compare`, `power`, `explain`, `diff`, `cluster` (with `--induce` taxonomy), `calibrate` (fault injection), `fork`, `evolve` (GEPA-style with minibatch verification and a Pareto front), `optimize` (Thompson sampling with a paired verdict), `ablate`, `bisect`, `import` (Claude Code sessions, Inspect, Docent, plugin-eval, Harbor, OTel), `export` (rollouts, OTel GenAI, Docent, JUnit, HTML), `serve ssh|reward|mcp`, `tui`.

- `sharpen` weighs cost: the search runs at the baseline's price (a config change whose own run costs clearly more is put on top of the final text once, not built on), a winning rewrite that sits on a config change is tried without it, and a candidate that costs clearly less and is within one standard error of the best is the winner. `--no-rewrites` has only the changes from files and the variants judged; `hone serve mcp --no-rewrites` is a server that only judges what its client proposes.
- Python targets for agents built with a framework: `params` reach the callable as `ctx.params`, `ctx.from_langchain` and `ctx.from_strands` record the whole conversation (tool calls, tool results, tokens, cost), `workers` serves calls at once, the version follows the Python source under the working directory, and what the module prints stays out of hone's output. `hone init` recognises LangChain and Strands projects and writes the function and the config.

### TUI
- OpenTUI dashboard: matrix, trace viewer with score context and search, side-by-side trajectory diff, failure clusters, judge calibration, candidates (Pareto), fork with inline edit and re-run, charts. Served over SSH.

### Ecosystem
- `hone init` wires coding agents: a skill with topic references in `.agents/skills/hone` and `.claude/skills/hone`, and the MCP server registered in `.mcp.json`; `hone guide` prints the skill; shipped docs; seven examples (`sharpen` shows the three commands on a toy that starts broken; `helpdesk-agent` is an in-house agent with tools in LangChain and in Strands, with 36 cases over six house rules; the other five are green under `hone test --ci`); compiled binaries for six platforms; release workflow with npm provenance.

### Deferred
- Kitty pixel charts inside the OpenTUI layout (the escape builder and PNG encoder exist; the charts screen uses character cells).
