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

## Three commands

```bash
# requires Bun >= 1.3.14
bunx hone-eval init   # set up: detects the project, writes hone.config.ts and example cases
hone test             # evaluate: runs every case, scores it, says how far to trust the score
hone sharpen          # improve: finds why cases fail, tries changes, re-tests, keeps what is proven
```

`hone` alone opens the results in the terminal. Every other command is one step of these three or a tool, and stays out of the way until you ask: `hone help all`.

This is `hone sharpen` on [`examples/sharpen`](./examples/sharpen/), a toy help-desk bot where nothing passes as written (real output, 16 seconds, four model calls):

```
Now: 0% of 12 cases pass. 6 more cases are held out for the final check.
Why it fails:
  1. unwarranted-refusal-idk (6 of 12 failed trials, e.g. cancel): The assistant gives a generic 'Sorry, I do not know.' answer instead of attempting the task, so its output...
  2. boilerplate-answer-wrapper (5 of 12 failed trials, e.g. ship-abroad): The assistant wraps its answer in conversational boilerplate (e.g. 'Thanks for asking! The answer is ...')...
  3. conversational-filler-padding (1 of 12 failed trials, e.g. shipping-time): The assistant wraps the requested answer in pleasantries or full-sentence framing (e.g. "Thanks for asking!...
Tried 3 changes:
  - loose matching               0% -> 0%   questions with extra words around them find nothing, because they are matched word for...
  + rewrite 1                    0% -> 50%   Replaces the polite full-sentence instruction with a bare-answer format that forbids wr...
  + loose matching on rewrite 1  0% -> 100%
Result: PROVEN. On 6 cases it never saw, loose matching on rewrite 1 takes the pass rate from 0% to 100%
(+100 points, 95% interval +100 to +100, p = 0.03).
The new text is in .hone/sharpen/20261013131032-best.txt (as a change file: .hone/sharpen/20261013131032-best.ts)
It uses the change "loose matching" from sharpen/loose-matching.ts.
```

Before trying anything it held six cases out. It named the failure modes, tried the change from the file (no gain alone), asked a model to rewrite the declared text (half), put the change on top of the rewrite (all), and checked the result on the six cases no proposal had seen. Six out of six is the fewest an exact test accepts at 5%, hence p = 0.03 and not more. When a change only fits the cases it learned from, the verdict is `NO GAIN`; when there are too few cases to tell, `PROMISING, not proven`, with the number that would settle it.

What it tries are **changes**: files under `sharpen/`, one idea each, with the reason. A person writes them, or a coding agent that read the diagnosis; the cycle treats both the same, and a model's own rewrite is saved in the same form.

```ts
// sharpen/terse-answers.ts
import { change } from "hone-eval";

change("answer with the bare value", {
  why: "the cases expect the answer alone; the bot wraps it in a sentence",
  text: "Reply with only the answer.",              // a new version of the prompt, the rule file, the rubric
  // config: (config) => withTopK(config, 30),      // or anything a config can express: a setting, a model, new code
});
```

### With a coding agent

`hone init` also installs a skill for Claude Code, Codex and Cursor (`.agents/skills/hone`, `.claude/skills/hone`) and registers an MCP server in `.mcp.json`. The skill teaches the agent the same loop a person follows: run `hone sharpen --budget 0`, read the diagnosis page it names, write one change file per hypothesis under `sharpen/`, run `hone sharpen`, and report the verdict as printed. The agent proposes; hone holds cases out and decides. `hone guide` prints the skill.

Checked once with a real session ([`docs/benchmarks/agent-writes-changes.md`](./docs/benchmarks/agent-writes-changes.md)): Claude Code, told only that the example bot had complaints and to use hone, loaded the skill, read the diagnosis page, wrote two change files, and hone confirmed the pair on six held-out cases in 31 seconds, with no model of its own available.

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

The single steps are commands of their own. `hone ablate` removes one component at a time and reports the paired delta per component; `hone optimize` spends a trial budget across candidates by Thompson sampling and then decides with a paired test; `hone` opens the dashboard over the latest run (captured from [`examples/harness-ablation`](./examples/harness-ablation)):

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

## Does it actually improve anything?

On one real system so far, with a person still driving. On [`kyu1204/rag_qa_eval`](https://github.com/kyu1204/rag_qa_eval) (a Korean government-policy citation RAG with a 43-question gold set and its own 0/1/2 scoring), hone measured the baseline, calibrated the judge, induced a failure taxonomy, rewrote the system prompt from the failure clusters and compared with 3 trials per case:

| system | useful | safe | paired vs baseline (useful) |
|---|---|---|---|
| baseline prompt, top_k 5 | 79.8% | 100% | |
| the authors' hand-tuned best (prompt v3, top_k 30) | 87.6% | 97.7% | +7.8 pts, p = 0.049 |
| **prompt evolved by `hone evolve`, top_k 30** | **88.4%** | **100%** | **+8.5 pts, p = 0.047** |

The automatic rewrite matched a week of hand tuning on usefulness and beat it on safety; with only 2 trials hone had said "no measurable effect" and told us how many more it needed. Full method, deviations and every artifact: [`docs/benchmarks/rag-policy-qa.md`](./docs/benchmarks/rag-policy-qa.md).

Read that table with three things in mind. The retrieval depth of 30 was the authors' find, and a person decided to put it together with the rewritten prompt; the prompt alone was +4.7 points and not significant. The 95% interval of the +8.5 points starts at +0.1, and the result does not survive a correction for the three comparisons. And the prompt was written and confirmed on the same 43 questions. `hone sharpen` was built afterwards to close those gaps: it holds cases out, and it tries a setting again on top of a rewrite without being told to. Re-running this study through it is planned (T-1006 in [`WORKPLAN.md`](./WORKPLAN.md)).

It also tells you when the thing you were about to tune is not the lever. On 15 coding tasks cut from this repository's history, given to Claude Code in a sandbox and graded by tests the agent never sees:

| what the agent got | resolved | est. cost per solved task |
|---|---|---|
| Sonnet, commit title and test names | 24% | $0.44 |
| Sonnet, the same plus six harness rules | 31% | $0.54 |
| Opus, commit title and test names | 49% | $1.06 |
| **Sonnet, written requirements** | **100%** | **$0.08** |

Failure clustering pointed at the cause: the hidden tests asserted names and wordings the statement never gave. Rules could not supply them, and a larger model guessed only some. In this study hone was the instrument: it ran and scored the sessions and named the failure modes, while a person read the traces, found the cause and wrote the rules, and a separate agent wrote the requirements. Method, two full passes and the three attempts that were thrown away first: [`docs/benchmarks/agent-harness.md`](./docs/benchmarks/agent-harness.md).

## A config

`hone init` writes one for the project it finds. It is a TypeScript file:

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

A target is an HTTP endpoint, a TypeScript or Python function, a command-line agent such as Claude Code in an isolated workspace, an MCP server, or recorded traces. `hone test --ci` turns the gates into an exit code, JUnit and a pull request comment; `hone import claude-code` brings existing Claude Code sessions in without running anything.

## Documentation

- [`docs/README.md`](./docs/README.md): index; [`docs/concepts.md`](./docs/concepts.md): the data model and the loop
- [`docs/cli.md`](./docs/cli.md): every command, generated from `--help`; the three everyday ones first
- [`docs/config.md`](./docs/config.md): `hone.config.ts`, targets, scorers, gates, ablations, and the `sharpen` block
- [`docs/analysis.md`](./docs/analysis.md): clustering, taxonomy, trajectory diff, judge calibration, branch points
- [`docs/correction.md`](./docs/correction.md): `hone sharpen` and its single steps: fork, evolve, optimize, ablate, bisect, compare
- [`docs/serve.md`](./docs/serve.md): ssh dashboard, reward API, MCP server
- [`docs/formats.md`](./docs/formats.md) and [`docs/compat.md`](./docs/compat.md): import/export formats with sources
- [`examples/`](./examples/): sharpen (the three commands on a toy that starts broken), helpdesk-agent (an in-house agent with tools, in LangChain and in Strands), qa-fn, rag-python, agent-claude-code, mcp-server, harness-ablation
- [`skills/hone/`](./skills/hone/SKILL.md): the skill `hone init` installs for coding agents, a short router with topic references (`hone guide <topic>`)

## How it compares

| | hone | promptfoo | deepeval | inspect_ai | Harbor |
|---|---|---|---|---|---|
| Unit of evaluation | trace (messages + spans) | output | output + metrics | sample + events | container trial |
| Targets | HTTP, function, Python, CLI agent, MCP, replay, Docker | providers | Python callables | Python solvers | containerized agents |
| Variance | n trials, pass^k, CIs, paired tests by default | repeat option | per-metric | epochs | per-task trials |
| Judge calibration | fault injection, kappa, order swap | rubric | rubric | rubric | rubric |
| Correction loop | one command (`hone sharpen`): diagnose, propose, re-test, confirm on held-out cases | no | no | no | no |
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
| P10 | three commands; `hone sharpen` runs the whole cycle with a held-out confirmation; changes are files a person or a coding agent writes. Next: the skill and MCP wiring for coding agents, and both studies re-run with no human decisions |

## Contributing

Pull requests are welcome once v0.1.0 lands. Until then, issues with real eval pain are the most useful thing you can send: a trace that fooled your judge, a harness comparison you wish you could run, a format you need imported. See [`CONTRIBUTING.md`](./CONTRIBUTING.md); contributions are signed off under the DCO, there is no CLA.

## License

[Apache-2.0](./LICENSE). The `hone` name and logo are not covered by the license.
