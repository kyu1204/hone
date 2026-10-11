---
name: hone
description: Evaluate and correct an AI system (RAG, agent, LLM QA, coding-agent harness) with hone. Use when asked to measure quality, find why cases fail, compare two versions, or prove an improvement with statistics.
---

# hone: evaluate, localize, correct, verify

hone stores every result as a trace (messages + spans) in `.hone/` and reports pass rates with confidence intervals. Never report an improvement without the paired verdict (`hone compare`, `hone evolve`, `hone optimize` print one).

## Setup (once)

1. `hone init` writes `hone.config.ts` (targets, cases, scorers, gates) and `evals/cases.yaml`. Edit the target to point at the system under test.
2. Keys live in `~/.config/hone/env` (`TYPESAFE_API_KEY` for the Jev judge, `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` for LLM judges and embeddings). Deterministic scorers need none.
3. Existing Claude Code sessions: `hone import claude-code` puts them in the matrix without running anything.

## The loop

1. Measure: `hone run --adaptive` (runs cases until intervals are tight; `--json` for machines). `hone matrix` shows per-target pass@1, cost and significance bands.
2. Localize: `hone cluster --induce` groups failures and names the failure modes (`.hone/analysis/clusters-<run>.json`). `hone explain <trialId>` prints one trial with fork candidates. `hone diff <a> <b>` aligns two trajectories and shows where they diverge.
3. Check the judge before trusting it: `hone calibrate --scorer <name>` injects faults into passing trials and reports what the scorer catches, its false alarms, and kappa against labels.
4. Propose: edit the prompt, rules, retrieval or tools. Or let hone propose: `hone evolve` (reflects on failures, verifies candidates on a minibatch then the full set, keeps the Pareto front).
5. Verify a single hypothesis cheaply: `hone fork <trialId> --step N --content "..."` re-runs from an edited message and reports the verdict change.
6. Compare: `hone compare <targetA> <targetB>` (paired, same cases) or `hone optimize` (Thompson sampling across named candidates, then a paired verdict). `hone ablate` measures what each component contributes; `hone bisect` finds the commit that broke a case.
7. Lock: `hone ci` gates on pass@1, pass^k, cost and regression against a baseline; writes JUnit and a PR comment.
8. Share: `hone report` (HTML), `hone export otel|docent|junit|rollouts`, `hone serve ssh` (dashboard over SSH).

## Reading results

- `pass@1` is the mean pass rate; the bracket after it is a 95% Wilson interval. Two targets whose intervals overlap are not shown as different.
- `no measurable effect` means p >= alpha on the paired test. Say that, not "slightly better".
- `reward-hack` flags mean the trace edited tests or assertions; treat the pass as suspect.
- Costs are in USD from provider pricing tables; `cached` flags mean the target output came from the content-addressed cache.

## MCP

`hone serve mcp` speaks MCP over stdio. Tools: `hone_run`, `hone_list_runs`, `hone_matrix`, `hone_compare`, `hone_explain`, `hone_cluster`, `hone_fork`. Each returns the same JSON the CLI prints with `--json`. Register it as `{"command": "hone", "args": ["serve", "mcp"]}` in the client's MCP settings and call the tools instead of shelling out.

## Rules

- Run `hone run` before and after a change; compare paired, on the same cases, with the same trials.
- Prefer `--adaptive` over a fixed trial count; prefer more cases over more trials when variance is between cases.
- Do not edit `.hone/` by hand; runs are content-addressed and the TUI reads them live.
- When a scorer and a human disagree, calibrate the scorer before changing the system.
