<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo.svg">
    <img alt="hone" src=".github/assets/logo-light.svg" width="372">
  </picture>
</p>

<p align="center">
  <b>Evaluate. Correct. Sharpen.</b><br>
  A terminal-first evaluation tool for RAG pipelines, agents, LLM QA and coding-agent harnesses.<br>
  One abstraction for every target. Statistics you can trust. A correction loop, not a scoreboard.
</p>

<p align="center">
  <a href="https://github.com/kyu1204/hone/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/kyu1204/hone/ci.yml?style=flat-square&label=ci"></a>
  <a href="https://www.npmjs.com/package/hone-eval"><img alt="npm" src="https://img.shields.io/npm/v/hone-eval?style=flat-square&color=2c6e9e"></a>
  <a href="./LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-2c6e9e?style=flat-square"></a>
</p>

> **Status:** v0.1.0. Built in public: the plan is in [`WORKPLAN.md`](./WORKPLAN.md), every task landed as a pull request you can read, and [`CHANGELOG.md`](./CHANGELOG.md) lists what shipped.

---

## Why

Most eval tools stop at a number. The number is usually a single run, graded by a judge nobody calibrated, on a harness nobody controlled for. Then the real work starts: reading transcripts, guessing what broke, editing a prompt, running again, and hoping the change was not noise.

`hone` is built around that loop instead of the number.

- **Everything is a Target, every result is a Trace.** A RAG endpoint, a TypeScript function, a Python module, Claude Code in a sandboxed workspace, an MCP server, or a pile of exported logs. Scorers look at the parts of the trace that matter for your domain: retrieved chunks, tool calls, the git diff, or just the output.
- **Variance is the default.** Every case runs `n` trials. You get pass^k with a confidence interval, paired comparisons, clustered standard errors and a power calculator, ported from the statistics in *Adding Error Bars to Evals*. Sampling stops early when the interval is tight enough.
- **The judge gets judged.** `hone calibrate` injects silent faults into passing runs and tells you what fraction your judge catches. Pairwise judgments always run both orders.
- **Harness is a variable, not a constant.** Run the same tasks across Claude Code, Codex, OpenCode and Aider. See pass rate next to tokens-per-solve and dollars-per-solve.
- **Failures get names.** Failed traces are clustered and a failure taxonomy is induced from your own system, then used to classify the next run.
- **Fix, then prove it.** Fork a trace at step `k` with an edited prompt or tool result and re-run only the tail. Propose prompt and rule changes from failure clusters. Confirm with a paired test, not a vibe. Gate CI on the result.
- **Agents can drive it.** `hone serve mcp` exposes the whole loop as MCP tools, so your coding agent can run evals, read failures and iterate on its own.
- **Cheap to re-run.** Target outputs and judge verdicts are content-addressed. Change a scorer or a rubric and nothing upstream is called again.

## What it looks like

<p align="center"><img alt="hone ablate, hone optimize and the dashboard on the harness-ablation example" src=".github/assets/demo.gif" width="880"></p>

`hone ablate` removes one component at a time and reports the paired delta per component; `hone optimize` spends a trial budget across candidates by Thompson sampling and then decides with a paired test; `hone` opens the dashboard over the latest run (captured from [`examples/harness-ablation`](./examples/harness-ablation)):

```
ablation      pass@1  delta    CI95            p        cost delta  verdict
answerwith    0.00    -1.00    [-1.00, -1.00]   0.0e+0   +$0.0000   component helps
roundto       0.75    -0.25    [-1.05, 0.55]   3.9e-1   +$0.0000   no measurable effect
neverinclude  0.75    -0.25    [-1.05, 0.55]   3.9e-1   +$0.0000   no measurable effect

  arm            trials   pass    95% CI        P(best)   cost
  baseline            5   100%   [ 57%, 100%]     73%   $0.0000
  no-units-rule       4    75%   [ 30%,  95%]     17%   $0.0000
  no-rounding         3    67%   [ 21%,  94%]     11%   $0.0000

spent 12 trials (stopped: budget)
verdict: baseline holds; no candidate beats it
```

The terminal UI is built on [OpenTUI](https://github.com/anomalyco/opentui): matrix, trace viewer with score context, side-by-side trajectory diff, failure clusters, judge calibration, candidates, fork, charts. `hone serve ssh` serves the same view read-only over SSH. Re-render the gif with `scripts/demo.sh`.

## Quick start

```bash
# requires Bun >= 1.3.14
bunx hone-eval init          # detects your project, writes hone.config.ts + evals/cases.yaml, stores keys
hone import claude-code      # existing Claude Code sessions show up in the matrix, no run needed
hone run --adaptive          # runs cases until confidence intervals are tight enough
hone                         # the dashboard
hone cluster --induce        # name the failure modes
hone compare rag@a rag@b     # paired comparison with significance
hone ci                      # per-axis thresholds, exit code, JUnit, PR comment
```

A config is a TypeScript file:

```ts
import { defineConfig, http, process, jev, regex, rag, gates } from "hone-eval";

export default defineConfig({
  targets: {
    rag: http({ url: "http://localhost:8000/ask", body: (c) => ({ q: c.input }) }),
    cc: process({ agent: "claude-code", workspace: "./fixtures/repo" }),
  },
  cases: "./evals/**/*.yaml",
  trials: 5,
  adaptive: { ciWidth: 0.15, maxTrials: 12 },
  scorers: [
    regex({ pattern: "^\\d+$" }),
    jev.noul("The answer cites a chunk that supports it"),
    rag.faithfulness(),
  ],
  gates: gates({ passHatK: { k: 3, min: 0.8 }, costUsd: { max: 0.5 }, rewardHack: "fail" }),
});
```

## Documentation

- [`docs/README.md`](./docs/README.md): index; [`docs/concepts.md`](./docs/concepts.md): the data model and the loop
- [`docs/cli.md`](./docs/cli.md): every command, generated from `--help`
- [`docs/config.md`](./docs/config.md): `hone.config.ts`, targets, scorers, gates, ablations, evolve, optimize
- [`docs/analysis.md`](./docs/analysis.md): clustering, taxonomy, trajectory diff, judge calibration, branch points
- [`docs/correction.md`](./docs/correction.md): fork, evolve, optimize, ablate, bisect, compare, ci
- [`docs/serve.md`](./docs/serve.md): ssh dashboard, reward API, MCP server
- [`docs/formats.md`](./docs/formats.md) and [`docs/compat.md`](./docs/compat.md): import/export formats with sources
- [`examples/`](./examples/): qa-fn, rag-python, agent-claude-code, mcp-server, harness-ablation, each green under `hone ci`
- [`skills/hone/SKILL.md`](./skills/hone/SKILL.md): the skill `hone init --skills` installs for Claude Code and Codex

## How it compares

| | hone | promptfoo | deepeval | inspect_ai | Harbor |
|---|---|---|---|---|---|
| Unit of evaluation | trace (messages + spans) | output | output + metrics | sample + events | container trial |
| Targets | HTTP, function, Python, CLI agent, MCP, replay, Docker | providers | Python callables | Python solvers | containerized agents |
| Variance | n trials, pass^k, CIs, paired tests by default | repeat option | per-metric | epochs | per-task trials |
| Judge calibration | fault injection, kappa, order swap | rubric | rubric | rubric | rubric |
| Correction loop | cluster, taxonomy, fork, evolve, bisect, ablate | no | no | no | no |
| Interface | TUI, CLI, MCP server, SSH | CLI, web | pytest | CLI, web | CLI |
| Runs offline, local-first | yes | yes | yes | yes | yes |

`hone` imports Inspect logs, Docent collections, Claude Code sessions, `claude plugin eval` suites and Harbor results, and exports OpenTelemetry GenAI spans, Docent collections and RL rollouts. It is meant to sit next to these tools, not replace your datasets.

## Architecture in one paragraph

Four layers. **Surfaces** (TUI, CLI, MCP, reward server, SSH, reports) talk to the **Engine** (plan, scheduler, executor, cache, scorers, store, stats) and to **Correction** (cluster, calibrate, fork, evolve, optimize, bisect). The Engine talks to **Adapters** (targets, importers, exporters, model providers). Only `providers/` touches the network, so the whole thing runs offline in tests with one stub. Results live in `.hone/` as JSON you can commit, with a SQLite index that can be rebuilt at any time.

## Roadmap

v0.1.0 ships everything above. Progress is tracked task by task in [`WORKPLAN.md`](./WORKPLAN.md), and each task has a work order in [`docs/work-orders/`](./docs/work-orders/). Phases:

| Phase | Scope |
|---|---|
| P0 | repo, data model, config, cache, store, Jev and LLM providers |
| P1 | targets: http, fn, python, process, mcp, replay, docker |
| P2 | scorers: deterministic, RAG, consistency, Jev judge, LLM judge, reward-hack detector |
| P3 | stats: intervals, pass^k, paired tests, clustered SE, power, IRT, bandit, sequential stopping |
| P4 | runner, CLI: run, compare, matrix, bisect, ablate, ci, init |
| P5 | TUI: matrix, trace viewer, diff, clusters, calibrate, fork, charts, ssh |
| P6 | analysis: clustering, taxonomy induction, trace diff, judge calibration |
| P7 | correction: fork, evolve, optimize, rollout export, reward server, MCP server |
| P8 | import/export adapters, skills, shipped docs |
| P9 | examples, docs, binaries, release |

## Contributing

Pull requests are welcome once v0.1.0 lands. Until then, issues with real eval pain are the most useful thing you can send: a trace that fooled your judge, a harness comparison you wish you could run, a format you need imported. See [`CONTRIBUTING.md`](./CONTRIBUTING.md); contributions are signed off under the DCO, there is no CLA.

## License

[Apache-2.0](./LICENSE). The `hone` name and logo are not covered by the license.
