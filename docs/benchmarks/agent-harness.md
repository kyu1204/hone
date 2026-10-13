# Benchmark study: what moves a coding agent, the model, the rules, or the task statement?

Date: 2026-10-13. Status: **complete.** Result in one line: on 15 tasks cut from this repository's history, Claude Code with Sonnet resolved 24% when the task statement was a commit title plus test names and 100% when it carried written requirements; harness rules added 7 points that cannot be told from noise for 57% more cost, and Opus added 24 points for 4.8 times the cost, still 51 points below the cheaper model with the better statement.

## Question

A coding-agent harness has three things you can change: the model, the rules in the system prompt, and what the task statement says. Which one moves the solve rate, and can a cheaper model with a better harness match a larger one?

## What was evaluated

Everything lives in [`benchmarks/agent-harness/`](../../benchmarks/agent-harness/): the task builder, the Claude Code invocation and scorers (`bench.ts`), the config, the contracts, the rules, and the results.

- **Agent**: Claude Code 2.1.296, headless (`claude -p`), `claude-sonnet-5-5` and `claude-opus-5-5`.
- **Tasks**: 15 commits of this repository, 9 fixes and 6 features. The workspace is the repository at the commit's parent without harness files, so the existing tests are visible. The commit's own test files are the hidden tests: 40 fail-to-pass and 49 pass-to-pass tests, measured by running them on the parent tree.
- **Resolved**: every fail-to-pass test passes and no pass-to-pass test breaks. A self-test without any agent checks the grader on all 15 tasks: the untouched tree is unresolved, the reference commit is resolved.
- **Isolation**: project settings only, no MCP servers, six tools, the OS sandbox with no network and no reads outside the working directory, a scrubbed environment, and ancestor instruction files excluded. Task trees, hidden tests and graded copies sit where the sandbox denies reads.
- **Trials**: 3 per task, 45 per cell. Every cell was run twice (see "Two passes").
- **Statistics**: per-task paired comparisons with hone's `compareTargets` (the unit is the task, the value its mean over trials), Wilson intervals, and the Holm-adjusted bands of `hone matrix`.

| cell | model | statement | rules |
|---|---|---|---|
| `sonnet-plain` | Sonnet | title only | none |
| `sonnet-plain-rules` | Sonnet | title only | `rules.md` appended to the system prompt |
| `opus-plain` | Opus | title only | none |
| `sonnet-spec` | Sonnet | title plus requirements | none |

**Title only** is the commit subject, how the result will be checked, the titles of the added tests and the import lines of new test files. **With requirements** adds a contract of 152 to 804 words that states every name, shape, wording and behaviour the hidden tests assert. A separate agent wrote the contracts from the reference commits and the hidden tests.

**Rules** are six general working rules: look for the written design and existing callers first, treat every test title as a requirement, write the test first, change as little as possible, verify after the last edit, say what you could not determine. They were written from the failures of the 8 dev tasks only. The 7 held-out tasks' failures were not read until the rules were frozen.

## Results

### 1. Measure and localize: the title-only baseline

Sonnet resolved 14 of 45 trials in the first pass. `hone cluster --induce` on the 15 failed dev trials named three failure modes: `unverified-new-behavior` (6), `unseen-tests-guessed-interface` (6) and `unverified-api-guesses` (3). Reading those failures against the hidden tests showed why the agent was guessing. The tests assert things the statement never gives:

- a field name, `meta.synthesizedMessages`;
- the wording of a warning, "2 of 2 trials errored";
- a return shape, `{ vectors, method }`, where the repository's own work order says `number[][]`.

The contract-writing agent listed every such item (`contracts/gaps.json`): **23 of the 40 fail-to-pass tests, in 12 of the 15 tasks, assert something that neither the title-only statement nor the starting tree determines.** The inventory has 40 distinct items, and five of them contradict a design document in the tree. A stricter reading raises 23 to 30.

That split explains the baseline. Clean pass, title-only statement:

| cell | 3 tasks the statement determines | 12 tasks with a test it does not determine |
|---|---|---|
| `sonnet-plain` | 6/9 = 67% | 5/36 = 14% |
| `sonnet-plain-rules` | 8/9 = 89% | 6/36 = 17% |
| `opus-plain` | 9/9 = 100% | 13/36 = 36% |

Every unresolved trial was also classified by which tests it failed (`gap_crosstab.py`, both passes, 90 trials per cell):

| cell | resolved | failed only tests the statement does not determine | failed a test it does determine |
|---|---|---|---|
| `sonnet-plain` | 25 | 58 | 7 |
| `sonnet-plain-rules` | 30 | 57 | 3 |
| `opus-plain` | 40 | 50 | 0 |
| `sonnet-spec` | 90 | 0 | 0 |

Of Sonnet's 65 unresolved trials, 58 failed only on tests the statement does not determine and 7 failed a test it does determine.

### 2. Correct, three ways, and compare

| cell | clean pass | first pass | both passes | tokens in / out | est. cost per trial | est. cost per solve | seconds | turns |
|---|---|---|---|---|---|---|---|---|
| `sonnet-plain` | 11/45 = 24% | 14/45 = 31% | 28% [20, 38] | 117k / 3.2k | $0.107 | $0.44 | 29 | 8.4 |
| `sonnet-plain-rules` | 14/45 = 31% | 16/45 = 36% | 33% [24, 44] | 195k / 5.6k | $0.168 | $0.54 | 45 | 11.8 |
| `opus-plain` | 22/45 = 49% | 18/45 = 40% | 44% [35, 55] | 282k / 8.9k | $0.518 | $1.06 | 99 | 15.6 |
| `sonnet-spec` | 45/45 = 100% | 45/45 = 100% | 100% [96, 100] | 73k / 2.4k | $0.082 | $0.08 | 22 | 5.9 |

Tokens, cost, seconds and turns are per trial in the clean pass. Cost is Claude Code's own estimate at API prices; the runs were on a subscription, so it is a relative measure, not money spent.

Paired by task, difference in resolved rate:

| comparison | clean pass | both passes |
|---|---|---|
| requirements against title only (Sonnet) | +75.6 pts [51.9, 99.2], p < 0.001, 12 tasks better, 0 worse | +72.2 pts [49.2, 95.3], p < 0.001 |
| rules against none (Sonnet, title only) | +6.7 pts [-3.7, 17.0], p = 0.19 | +5.6 pts [-3.5, 14.6], p = 0.21 |
| the same on the 7 held-out tasks | +9.5 pts [-13.8, 32.8], p = 0.36 | +9.5 pts [-8.0, 27.0], p = 0.23 |
| Opus against Sonnet (title only) | +24.4 pts [3.0, 45.9], p = 0.028, 5 tasks better, 0 worse | +16.7 pts [1.5, 31.9], p = 0.034 |
| Sonnet with requirements against Opus with title only | +51.1 pts [24.2, 78.0], p = 0.001, 9 tasks better, 0 worse | +55.6 pts [29.5, 81.6], p < 0.001 |
| Sonnet with rules against Opus (title only) | -17.8 pts [-36.1, 0.5], p = 0.056 | -11.1 pts [-25.4, 3.1], p = 0.12 |

`hone matrix` on the clean pass, which adjusts for all six pairs (Holm), puts `sonnet-spec` alone in band A and the three title-only cells together in band B.

### Reading

1. **The statement is the lever.** Completing it took the cheaper model from 24% to 100% on every task and in every trial of two passes, and made it cheaper to run: 38% fewer tokens, 2.5 fewer turns. No other change came close.
2. **Rules were obeyed and did not measurably help.** Trials that wrote a test went from 4% to 100% and trials that ran the tests from 82% to 100%. The solve rate moved by 6 to 7 points, inside the noise, for 57% more estimated cost and 55% more time. What rules can fix is the agent's own mistakes, which fell from 7 to 3 of 90 trials; that is too few events to call. They cannot supply a name the statement does not contain. They can also mislead: on the task whose work order names a return type the reference does not use, 2 of 6 trials with the rules returned the work order's type and none of 6 without them did.
3. **The larger model guesses better, at a price.** Opus resolved more than Sonnet in both passes and never failed a test the statement determines in 90 trials. On the 12 underdetermined tasks it matched the maintainers' unstated choices more often (36% against 14%). The difference is significant on its own (p about 0.03) and not after correcting for the six comparisons made here, so treat it as likely rather than established. It costs 4.8 times as much per trial and takes 3.4 times as long.
4. **A cheaper model with a better statement beats a larger model with a vague one** by 51 points, at one sixth of the cost per trial and one thirteenth of the cost per solved task.

### What 100% does and does not mean

The contracts were written with the hidden tests in hand. They are an upper bound on what a requester can specify, not a typical ticket, and in six tasks they pin details close to implementation (a hash function, a shuffle, a scoring formula) because the tests check exact values. The finding is the size of the gap between the two statements, not that a good ticket yields 100%.

It also means these tasks stop discriminating once they are specified. With requirements Sonnet is at the ceiling, so neither rules nor a larger model can show anything there. That is why the rules and the larger model were tested on the title-only statement.

## Two passes

The first pass looked finished and had two flaws, both found by reading traces:

- **An instruction file leaked in.** One Opus session's first command tried to read a notes file in the operator's home directory, which nothing in the task mentions. The workspaces live under the home directory, and Claude Code reads `.claude/CLAUDE.md` from every ancestor directory, so the operator's personal instruction file was loaded in all 180 sessions as a project file. It concerns note-keeping, not coding. The sandbox denied the read. The `claudeMdExcludes` setting closes it.
- **The launching session's environment was inherited.** The benchmark was started from inside a Claude Code session, and the agents received its session id, messaging socket and effort variable. A probe showed the same amount of reasoning with and without them. The runner now passes a scrubbed environment, and hone itself no longer forwards these variables (#97).

Both flaws were the same in every cell, so the comparisons inside the first pass stand. All four cells were run again with both closed. The clean pass is the main result and the first pass a replication under slightly different conditions. Rates for one cell moved by 5 to 9 points between passes, which is what 45 trials can do by chance and a reason not to read small differences from a single pass.

## What went wrong before that

Three earlier attempts were thrown away. Their summaries are in [`benchmarks/agent-harness/pilot/`](../../benchmarks/agent-harness/pilot/).

| attempt | what it showed | why it does not count |
|---|---|---|
| tests visible in the workspace | every target 30/30 | The agent iterates until the tests pass. There is no headroom, so nothing can be compared. |
| hidden tests, first try | Opus 47%, Sonnet 27%, Sonnet with rules 23% | Sessions loaded the operator's whole setup: 18 plugins, 21 MCP servers, 171 tools, hooks, about 400k tokens per trial. One agent fetched the upstream repository with the operator's authenticated `gh`. Hidden tests, the real repository and other tasks' solutions were readable on disk. Some fix tasks started with failing tests. |
| hidden tests, second try | 4 of 90 trials ran | The subscription limit was reached and 86 trials failed with an empty error message. |

Later the first isolated stage failed in every trial because of a hone bug (#96), and 27 trials were flagged as trying to reach the network when they had run the local type checker.

## Limitations

- Fifteen small tasks from one TypeScript repository, each a change to one or two modules. With 15 tasks the paired test detects differences of about 15 points; a smaller effect of the rules is not excluded.
- The oracle is the original commit's tests, which encode the maintainers' arbitrary choices. Failing under the title-only statement often means "different from the maintainers", not "broken". Nobody judged whether the failing implementations were acceptable.
- The contract writer checked sufficiency by implementing every task from the contract alone and passing the hidden tests, but it had already seen the tests. The gap inventory is the same agent's judgement.
- One hand-written rule set, from 15 failed dev trials. No search over rules was run, because one evaluation is 45 agent sessions. The rule author had seen the held-out tasks' statements and contracts, though not their failures.
- The dev and held-out split matters only for the rules comparison. Contracts exist for all tasks.
- `opus-spec` and Opus with rules were not run.
- One operator, one machine, one day.

## What this study found in hone itself

Fixed and merged the same day:

- #94 process targets: a workspace per case (`{caseId}`), `node_modules` linked into isolated copies.
- #95 Claude Code stream parsing: one turn per message id, cache tokens counted (a trial reported 16 input tokens where the session used 399,457), and the session's plugins, MCP servers, hooks and subscription utilization kept in the trace; an exit error carries what the agent printed when stderr is empty.
- #96 `fn` scorer: an explicit `pass: null` stays undecided.
- #97 process targets: the child does not inherit the launching Claude Code session's variables.

Not built, done here by scripts: resumable batches with one merged view (`run_stage.py`, `merge_runs.ts`), an isolation preset for agent targets (`bench.ts`), a scorer that audits whether an agent tried to leave its task, and a check of whether a statement determines what its tests assert.

## Cost and time

- Subscription use: the clean pass took 81 minutes and about half of one five-hour window. At API list prices Claude Code estimates it at about $39; nothing was billed.
- API spend: only the `hone cluster --induce` calls, a few cents.
