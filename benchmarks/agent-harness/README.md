# Coding-agent harness benchmark

Fifteen tasks cut from this repository's own history, given to Claude Code in an isolated sandbox and graded by the
original commit's tests, which the agent never sees. It answers three questions on the same tasks: how much does the
task statement matter, how much do harness rules matter, how much does the model matter. Results and discussion:
[`docs/benchmarks/agent-harness.md`](../../docs/benchmarks/agent-harness.md).

## How a task works

- **Workspace**: the repository at the commit's parent, minus harness files (`CLAUDE.md`, `AGENTS.md`, `.claude`, ...),
  so the existing tests are visible and the harness is the variable under test.
- **Hidden tests**: the commit's version of its test files. The grader copies the agent's workspace, puts those files
  in place and runs them.
- **Resolved**: every fail-to-pass test passes and no pass-to-pass test breaks. Which tests are which was measured by
  running them on the parent tree, not assumed (`baseline.json`).
- **Splits**: 8 dev tasks and 7 held-out tasks, drawn with a fixed seed. Rules were written from dev failures only.

## Variables

| variable | values | where |
|---|---|---|
| statement | title only (`cases.json`): commit subject, the titles of the added tests, import lines. With requirements (`cases-spec.json`): the same plus a written contract from `contracts/<id>.md` | `HONE_BENCH_STATEMENT` |
| rules | none, or `rules.md` appended to the system prompt | targets ending in `-rules` |
| model | `sonnet`, `opus` (Claude Code aliases) | target name |

Cells run in the study: `sonnet-plain`, `sonnet-plain-rules`, `opus-plain` (title only) and `sonnet-spec` (with
requirements). The other combinations the config defines were not run.

## Isolation

Every trial runs `claude -p` with `--setting-sources project` (none of the operator's plugins, hooks or settings), no MCP
servers, six tools, session persistence off, and the OS sandbox on with no network, no reads outside the working
directory and no unsandboxed commands (`SETTINGS` in `bench.ts`). Two things are easy to miss and are closed
explicitly: Claude Code reads `CLAUDE.md` and `.claude/CLAUDE.md` from every ancestor of the working directory
(`claudeMdExcludes`), and a benchmark started from inside a Claude Code session hands that session's environment
variables to the agents (`run_stage.py` passes a scrubbed environment). Task trees, hidden tests and graded copies
live under the home directory, which the sandbox denies; an agent can read only its own workspace. `probe.ts` runs a
session with the exact invocation and tries to get out.

## Reproduce

```sh
python3 build_tasks.py          # task trees, hidden tests, cases.json, baseline.json (outside the repo)
bun selftest.ts                 # grader check: untouched tree unresolved, reference commit resolved, all 15 tasks
python3 build_spec_cases.py     # cases-spec.json from cases.json + contracts/
./run_pass.sh                   # the four cells, 15 tasks x 3 trials each, in batches; resumable
bun analyze.ts                  # results/summary.md, summary.json, trials.jsonl
python3 gap_crosstab.py         # unresolved trials by whether the statement determines the tests they failed
bun merge_runs.ts               # optional: one merged run so `hone matrix`, `compare`, `cluster` work on everything
```

`run_stage.py` reads the subscription utilization Claude Code reports and stops before a limit is hit; the same
command resumes. A batch with a trial error is not recorded.

## Files

- `bench.ts`: Claude Code invocation, sandbox settings, the `resolved` scorer and three informational scorers
  (did the agent try to leave the task, did it run tests, did it write tests).
- `contracts/`: one requirements contract per task, and `gaps.json`, the list of things each task's tests assert
  that the title-only statement does not determine.
- `rules.md`: the harness rules tested here.
- `runs.json`, `results/`: the clean pass (which run holds which batch, and the analysis output).
  `runs-pass1.json`, `results/pass1/`: the first pass, run before the two isolation fixes above.
  `runs-both.json`, `results/both-passes/`: the two together. The run stores themselves (`.hone/`) are not committed;
  `results/*/trials.jsonl` has one line per trial without the transcript.
- `pilot/`: summaries of three earlier attempts that were invalid, kept as a warning (see the report).
