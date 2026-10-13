# hone docs

| page | what it covers |
|---|---|
| [concepts.md](./concepts.md) | the data model (Target, Case, Trial, Trace, Score, Verdict), caching, the correction loop |
| [cli.md](./cli.md) | every command with its options, generated from `--help` |
| [config.md](./config.md) | `hone.config.ts`: targets, cases, scorers, gates, ablations, evolve, optimize, keys |
| [analysis.md](./analysis.md) | failure clustering and taxonomy, trajectory diff, judge calibration, branch points |
| [correction.md](./correction.md) | `hone sharpen` step by step, change files, and the single steps: fork, evolve, optimize, ablate, bisect, compare, ci |
| [serve.md](./serve.md) | the SSH dashboard, the reward HTTP API, the MCP server |
| [formats.md](./formats.md) | import and export formats |
| [compat.md](./compat.md) | sources and dated decisions for every external format |
| [benchmarks/](./benchmarks/) | what was measured so far, each with what it does not show: [an in-house agent in LangChain and Strands](./benchmarks/custom-agents.md), [a citation RAG](./benchmarks/rag-policy-qa.md), [Claude Code on 15 tasks](./benchmarks/agent-harness.md), [a coding agent writing the changes](./benchmarks/agent-writes-changes.md) |
| [release.md](./release.md) | how a release is cut: version, changelog, tag, workflow, trusted publishing |
| [hardening.md](./hardening.md) | branch protection, repository settings, workflow permissions, and the live check |
| [launch/](./launch/) | Show HN, thread and awesome-list drafts |
| [work-orders/](./work-orders/) | the task-by-task build log behind `WORKPLAN.md` |

Start with [concepts.md](./concepts.md), then the example closest to your system in [`examples/`](../examples/).
