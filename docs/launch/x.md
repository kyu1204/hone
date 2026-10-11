# X / Bluesky thread draft

1/ hone: a terminal-first eval tool for RAG, agents and coding-agent harnesses that does not stop at a number. Measure, localize, correct, verify, in one CLI. Apache-2.0. https://github.com/kyu1204/hone

2/ Every result is a trace (messages + spans), not an output. Scorers look at retrieved chunks, tool calls, the git diff. `hack` flags test tampering by the agent.

3/ Variance is the default: n trials, pass^k with intervals, paired comparisons on the same cases, clustered standard errors, a power calculator. Sampling stops when intervals are tight enough.

4/ The judge gets judged. `hone calibrate` injects silent faults into passing runs and reports the detection rate per fault type, plus false alarms and kappa against your labels.

5/ Fix and prove it: `hone fork` re-runs from an edited step, `hone evolve` proposes text changes from failure clusters, `hone optimize` spends a budget by Thompson sampling. Each ends with a paired verdict; "no measurable effect" is a real answer.

6/ Agents can run it: `hone serve mcp` exposes the loop as tools. `hone import claude-code` puts your existing sessions in the matrix with no run at all.
