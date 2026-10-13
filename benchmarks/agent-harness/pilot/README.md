# Invalid earlier attempts

These summaries are kept as a warning, not as results. Each attempt looked like a finished benchmark and was not.

| attempt | what it showed | why it does not count |
|---|---|---|
| visible tests (`visible-tests-matrix.json`) | every target solved every task, 30/30 | With the acceptance tests in the workspace the agent iterates until they pass. No headroom, so nothing can be compared. |
| hidden tests, first try (`hidden-tests-matrix.json`) | opus 47%, sonnet 27%, sonnet with rules 23% | The sessions loaded the operator's own Claude Code setup (18 plugins, one of which injects text at session start, 21 MCP servers, 171 tools, hooks, about 400k tokens per trial). One agent fetched the upstream repository with the operator's authenticated `gh`. Hidden tests, the real repository and other tasks' solutions were readable on disk. Task trees were missing a directory, so some "fix" tasks started with failing tests. |
| hidden tests, second try | 4 of 90 trials ran | The subscription limit was reached; 86 trials failed with an empty error message. |

What changed afterwards is in the report: [`docs/benchmarks/agent-harness.md`](../../../docs/benchmarks/agent-harness.md).
