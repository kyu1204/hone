# hone docs

| page | what it covers |
|---|---|
| [concepts.md](./concepts.md) | the data model (Target, Case, Trial, Trace, Score, Verdict), caching, the correction loop |
| [cli.md](./cli.md) | every command with its options, generated from `--help` |
| [config.md](./config.md) | `hone.config.ts`: targets, cases, scorers, gates, ablations, evolve, optimize, keys |
| [analysis.md](./analysis.md) | failure clustering and taxonomy, trajectory diff, judge calibration, branch points |
| [correction.md](./correction.md) | fork, evolve, optimize, ablate, bisect, compare, ci and how verdicts are decided |
| [serve.md](./serve.md) | the SSH dashboard, the reward HTTP API, the MCP server |
| [formats.md](./formats.md) | import and export formats |
| [compat.md](./compat.md) | sources and dated decisions for every external format |
| [release.md](./release.md) | how a release is cut (arrives with the release workflow) |
| [work-orders/](./work-orders/) | the task-by-task build log behind `WORKPLAN.md` |

Start with [concepts.md](./concepts.md), then the example closest to your system in [`examples/`](../examples/).
