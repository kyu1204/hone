# Changelog

All notable changes to hone are recorded here. The format follows Keep a Changelog; versions follow semver.

## 0.1.0 (2026-10-12)

First release. Everything below landed as reviewed pull requests #1 to #80 on https://github.com/kyu1204/hone; each task has a work order under `docs/work-orders/`.

### Core
- Data model: Target, Case, Trial, Trace (OpenAI/Docent-compatible messages plus spans), Score, Verdict; JSON store under `.hone/` with a rebuildable SQLite index; content-addressed caching of target outputs and judge results.
- Config as TypeScript (`hone.config.ts`), YAML/JSON/JSONL cases, gates, ablations, evolve and optimize hooks.

### Targets
- `http`, `fn`, `python` (embedded bridge), `process` (Claude Code, Codex, OpenCode, Aider, generic, with workspace isolation and stream parsers), `mcp` (own JSON-RPC client), `replay`, `docker` (Harbor task directories, ATIF trajectories); `resume(prefix)` for forks.

### Scorers
- Deterministic: exact, contains, regex, json-schema, tool_used, tool_order, step_count, cost, latency, file_exists, test_command; `hack` reward-hack detector on diffs.
- RAG: context recall/precision, citations, faithfulness, answer relevance over retrieval spans.
- Judges: Jev System One (noul, score, choice, per-step), LLM rubric and pairwise with order swap; consistency over metamorphic mutations.

### Statistics
- Wilson/CLT/bootstrap intervals, pass@k and pass^k, paired t with exact McNemar, cluster-robust errors, Holm-adjusted leaderboard bands, noncentral-t power, sequential stopping, 2PL IRT, Thompson sampling. Test vectors from errorbars/scipy/statsmodels.

### Commands
- `run` (adaptive sampling), `matrix`, `compare`, `ci` (gates, JUnit, PR comment), `init`, `power`, `explain`, `report`, `diff`, `cluster` (with `--induce` taxonomy), `calibrate` (fault injection), `fork`, `evolve` (GEPA-style with minibatch verification and a Pareto front), `optimize` (Thompson sampling with a paired verdict), `ablate`, `bisect`, `import` (Claude Code sessions, Inspect, Docent, plugin-eval, Harbor, OTel), `export` (rollouts, OTel GenAI, Docent, JUnit, HTML), `serve ssh|reward|mcp`, `tui`.

### TUI
- OpenTUI dashboard: matrix, trace viewer with score context and search, side-by-side trajectory diff, failure clusters, judge calibration, candidates (Pareto), fork with inline edit and re-run, charts. Served over SSH.

### Ecosystem
- `hone init --skills` installs a skill for Claude Code and Codex; shipped docs; five examples green under `hone ci`; compiled binaries for six platforms; release workflow with npm provenance.

### Deferred
- Kitty pixel charts inside the OpenTUI layout (the escape builder and PNG encoder exist; the charts screen uses character cells).
