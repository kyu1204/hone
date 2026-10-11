# Concepts

## Data model

```
Target  --run(case.input)-->  Trace  --scorers-->  Score[]  -->  Trial (pass | fail | undecided)
   ^                                                                 |
   |  n trials per (case, target) cell                               v
 Case (id, input, expected?, rubric?, tags?)                   Verdict per cell: pass@1, pass^k, Wilson CI
```

- **Target**: anything that answers an input. Kinds: `http`, `fn`, `python`, `process` (a CLI agent in an isolated workspace), `mcp`, `replay`, `docker`. Targets may support `resume(prefix)` so a fork can continue from an edited message.
- **Case**: one input with optional expected output, rubric, tags and a `cluster` for clustered standard errors.
- **Trace**: the full record of one run: `messages` (OpenAI-compatible chat messages with tool calls), `spans` (`llm | tool | retrieval | agent | custom` with timings and attributes), `output`, `usage`, `artifacts` (diff, files, stdout), `error`, `meta`.
- **Score**: one scorer's judgement: `value` in 0..1, `pass` true/false/null, `reason`, `evidence`.
- **Trial**: a trace plus its scores, flags (`reward-hack`, `cached`, `timeout`, `forked-from:<id>`), verdict and cost.
- **Verdict**: per (case, target) cell over its trials: pass@1, pass^k, interval, and whether sampling stopped early.

Everything is stored under `.hone/` as JSON with a SQLite index that `hone` rebuilds when missing.

## Caching

Target outputs are cached by `(input, target version)`; scorer results by `(trace content, scorer spec, judge model)`. Changing a rubric re-runs only the judge; changing the target re-runs only that target. `--no-cache` bypasses both.

## Statistics

Pass rates carry Wilson intervals. Comparisons are paired on the same cases (paired t, exact McNemar for binary outcomes, cluster-robust errors when cases declare a `cluster`). `hone power` tells you how many cases a given effect needs. Adaptive sampling (`--adaptive`) keeps running a cell until its interval is narrower than the configured width. A result is reported as an improvement only when the paired test says so; otherwise hone prints `no measurable effect`.

## The correction loop

```
 measure ──> localize ──> propose ──> verify ──> compare ──> lock
 hone run    hone cluster  edit, or   hone fork  hone compare  hone ci
 hone matrix hone explain  hone evolve           hone optimize
 hone calibrate (is the judge trustworthy?)       hone ablate / bisect
```

Each arrow is a command; each command reads the store the previous one wrote. The TUI (`hone`) shows the same data live, and `hone serve mcp` exposes the loop to an agent.
