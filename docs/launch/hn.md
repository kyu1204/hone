# Show HN draft

**Title:** Show HN: Hone – a terminal-first eval tool that closes the loop (RAG, agents, coding harnesses)

**First comment (author):**

I built hone because every eval tool I used stopped at a number, and the number was usually one run graded by a judge nobody had checked. The actual work was reading transcripts, guessing what broke, editing a prompt, re-running, and hoping the change was not noise.

hone is organised around that loop instead. Everything you evaluate (an HTTP endpoint, a function, a Python module, Claude Code in a sandboxed workspace, an MCP server, a pile of exported logs) is a Target; every result is a Trace with messages and spans, so scorers can look at retrieved chunks, tool calls or the git diff rather than only the output.

A few things I think are different:

- Variance is the default: n trials per case, pass^k with Wilson intervals, paired comparisons, clustered standard errors, a power calculator (ported from "Adding Error Bars to Evals"). Sampling stops early when intervals are tight.
- The judge gets judged: `hone calibrate` injects silent faults (an unsupported claim, a swapped tool result, a removed verification step) into passing runs and reports what fraction the judge catches.
- Failures get names: failed traces are clustered and a taxonomy is induced from your own system, then reused to classify the next run.
- Fix, then prove it: fork a trace at step k with an edited message and re-run the tail; `hone evolve` proposes text changes from failure clusters and verifies them on a minibatch; `hone optimize` allocates a trial budget by Thompson sampling. Every one of these ends with a paired verdict and says "no measurable effect" when that is the truth.
- Agents can drive it: `hone serve mcp` exposes the loop as MCP tools.

It is a Bun/TypeScript CLI with a TUI (OpenTUI) and zero runtime dependencies beyond the TUI. Apache-2.0. Imports Inspect, Docent, Claude Code sessions, `claude plugin eval` suites and Harbor results; exports OpenTelemetry GenAI spans, Docent, JUnit and RL rollouts.

Repo: https://github.com/kyu1204/hone. Happy to answer questions about the statistics or the judge calibration design.
