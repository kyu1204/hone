---
name: hone
description: Evaluate and correct an AI system (RAG, agent, LLM QA, coding-agent harness) with hone. Use when asked to measure quality, find why cases fail, compare two versions, or prove an improvement with statistics.
---

# hone: evaluate, then sharpen

Three commands cover the normal path: `hone init` (once), `hone test` (evaluate), `hone sharpen` (improve). `hone help all` lists the single steps and tools below.

hone stores every result as a trace (messages + spans) in `.hone/` and reports pass rates with confidence intervals. Never report an improvement without a verdict from hone (`hone sharpen`, `hone compare`, `hone evolve` and `hone optimize` print one).

## Setup (once)

1. `hone init` writes `hone.config.ts` (targets, cases, scorers, gates) and `evals/cases.yaml`. Edit the target to point at the system under test.
2. Keys live in `~/.config/hone/env` (`TYPESAFE_API_KEY` for the Jev judge, `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` for LLM judges and embeddings). Deterministic scorers need none.
3. Existing Claude Code sessions: `hone import claude-code` puts them in the matrix without running anything.

## Improve: `hone sharpen`

`hone sharpen` runs the whole cycle and prints a plain account: the pass rate now, why cases fail, each change it tried, and a verdict. It holds a third of the cases out before proposing anything and confirms the best change on those.

- It tries **changes**: files under `sharpen/` that call `change(name, { why, text, config })`. Write one file per hypothesis after reading why cases fail. `text` is a new version of the text declared in `sharpen.text`; `config` is a function from a config to a config. Put new code in a new file and point the config at it; never edit a file the baseline runs. Inline `sharpen.variants` and, with a key, a model's rewrites are tried too.
- Verdicts: `PROVEN` (adopt it), `PROMISING, not proven` (the account says how many held-out cases would settle it; do not report it as an improvement), `NO GAIN` (keep what you have), `Nothing to sharpen`, `Nothing to change`, `Cannot measure` (the system errored; fix that first).
- Before writing a change, run `hone sharpen --budget 0` and read the page it names, `.hone/sharpen/<id>-diagnosis.md`: the failure modes with failing cases in full. Do not open the case files themselves; some cases are held out for the final check.
- The winning text is in `.hone/sharpen/<id>-best.txt`, the full ledger in `.hone/sharpen/<id>.json`. `--json` prints the ledger; `--budget`, `--max-cost` and `--until` bound the search.
- Without an LLM key it tries the variants only and says that rewrites were skipped.

## The single steps

Use these when you need one step on its own, or to look into what `hone sharpen` reported.

1. Measure: `hone test --adaptive` (runs cases until intervals are tight; `--json` for machines). `hone matrix` shows per-target pass@1, cost and significance bands.
2. Localize: `hone cluster --induce` groups failures and names the failure modes (`.hone/analysis/clusters-<run>.json`). `hone explain <trialId>` prints one trial with fork candidates. `hone diff <a> <b>` aligns two trajectories and shows where they diverge.
3. Check the judge before trusting it: `hone calibrate --scorer <name>` injects faults into passing trials and reports what the scorer catches, its false alarms, and kappa against labels.
4. Propose: edit the prompt, rules, retrieval or tools. Or let hone propose: `hone evolve` (reflects on failures, verifies candidates on a minibatch then the full set, keeps the Pareto front).
5. Verify a single hypothesis cheaply: `hone fork <trialId> --step N --content "..."` re-runs from an edited message and reports the verdict change.
6. Compare: `hone compare <targetA> <targetB>` (paired, same cases) or `hone optimize` (Thompson sampling across named candidates, then a paired verdict). `hone ablate` measures what each component contributes; `hone bisect` finds the commit that broke a case.
7. Lock: `hone test --ci` gates on pass@1, pass^k, cost and regression against a baseline; writes JUnit and a PR comment.
8. Share: `hone test --report` (HTML), `hone export otel|docent|junit|rollouts`, `hone serve ssh` (dashboard over SSH).

## Reading results

- `pass@1` is the mean pass rate; the bracket after it is a 95% Wilson interval. Two targets whose intervals overlap are not shown as different.
- `no measurable effect` means p >= alpha on the paired test. Say that, not "slightly better".
- `reward-hack` flags mean the trace edited tests or assertions; treat the pass as suspect.
- Costs are in USD from provider pricing tables; `cached` flags mean the target output came from the content-addressed cache.

## MCP

`hone serve mcp` speaks MCP over stdio. Tools: `hone_run`, `hone_list_runs`, `hone_matrix`, `hone_compare`, `hone_explain`, `hone_cluster`, `hone_fork`. Each returns the same JSON the CLI prints with `--json`. Register it as `{"command": "hone", "args": ["serve", "mcp"]}` in the client's MCP settings and call the tools instead of shelling out.

## Rules

- Run `hone test` before and after a change; compare paired, on the same cases, with the same trials.
- Prefer `--adaptive` over a fixed trial count; prefer more cases over more trials when variance is between cases.
- Do not edit `.hone/` by hand; runs are content-addressed and the TUI reads them live.
- When a scorer and a human disagree, calibrate the scorer before changing the system.
