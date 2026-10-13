# Benchmark: the cycle on an in-house agent, in LangChain and in Strands

Date: 2026-10-13. Status: **one run per arm, 12 held-out cases.** A first measurement on a small agent, not a ranking of frameworks or of proposers.

Result in one line: starting from a one-line prompt, the cycle took the helpdesk agent from about 40% to 96-100% of held-out cases in one framework per arm and stopped at "promising" in the other, at 1.1 to 1.8 times the baseline cost per case; in both unproven cases a held-out case had got worse, and in one of them the new prompt made the agent reset a password without checking who was asking.

| | hone's own model writes the rewrites | Codex writes the change files, hone only judges |
|---|---|---|
| **LangChain** | PROMISING: 50% to 83% (p = 0.45) | **PROVEN: 42% to 96%** (p = 0.016, needed < 0.025), 1.1x cost |
| **Strands** | **PROVEN: 42% to 100%** (p = 0.016, needed < 0.025), 1.8x cost | PROMISING: 33% to 83% (p = 0.07) |

Pass rates are on the 12 held-out cases, two trials each. The left column is the result after the fixes this benchmark led to; the first run of that column chose a winner that cost 4.7 to 4.9 times the baseline (see "What the first runs got wrong").

## Setup

- **The agent**: [`examples/helpdesk-agent`](../../examples/helpdesk-agent/). Six tools over in-memory data, the same agent in LangChain 1.4.5 (`create_agent`) and in Strands 1.60.0, on `claude-haiku-5-5`. The prompt is one line: `You are the Acme internal helpdesk assistant. Help employees with their questions.`
- **The cases**: 36 requests, six for each of six house rules (cite the policy id in brackets, verify identity before a password reset, look a leave balance up, the right ticket category and priority, a security incident is urgent and names the address to write to, say so and hand the question on when no policy covers it). Three scorers read the recorded conversation: which tools were called and in which order, with which arguments, and what the answer says.
- **The split**: 24 cases to learn from and 12 held out, the same for every arm (seed 1). The held-out cases cover all six rules.
- **Each arm** ran in its own copy of the project with one framework, hone installed from a packed tarball, and an empty `.hone`: [`benchmarks/custom-agents/project.sh`](../../benchmarks/custom-agents/project.sh).
- **Model arm**: `hone sharpen --max-cost 4`. hone's model (`claude-sonnet-5-5`) names the failure modes and rewrites the prompt. No change file, no person.
- **Codex arm**: Codex CLI 0.149.1 with `gpt-5.6-sol` at its default reasoning level, one session per framework ([`codex.sh`](../../benchmarks/custom-agents/codex.sh)). The operator's Codex config, rules, hooks, memories, plugins and shell environment were left out. The shell was sandboxed with no network, so it could not run the agent. hone was reachable as an MCP server started with `--no-rewrites`, which holds the API key and only judges ([`hone-mcp.sh`](../../benchmarks/custom-agents/hone-mcp.sh)). The skill from `hone init --skills` was in the project. The whole instruction:

  > This project is our internal helpdesk agent. Employees complain about its answers. Use hone to find out what it gets wrong and make it better, then tell me what you found and what hone's verdict is. Your shell has no network access and no API key, so it cannot run the agent: the hone MCP tools can.

## Where it starts

Both frameworks pass 33 of 72 trials on all 36 cases. Passed trials out of 12, by rule:

| rule | langchain | strands |
|---|---|---|
| cite | 0 | 0 |
| verify | 12 | 12 |
| lookup | 12 | 12 |
| ticket | 6 | 7 |
| security | 3 | 2 |
| nopolicy | 0 | 0 |

The agent keeps the two rules a model keeps unprompted and breaks the four that are this company's conventions. The two frameworks agree, so the failures come from the prompt.

## Model arm

What the cycle tried, as pass rates on the 24 cases it learned from:

| candidate | LangChain | Strands |
|---|---|---|
| baseline | 54% | 48% |
| variant `model: sonnet` (three times the price) | 62% | 62% |
| rewrite 1, written on top of the variant | 69% | 88% |
| rewrite 2, written on top of rewrite 1 | 92% | 100% |
| rewrite 2 without the variant | 90% | 98% |

The cycle then chose rewrite 2 without the larger model: one case of difference is not worth 2.7 to 3.0 times the cost. On the held-out cases:

| | baseline | rewrite 2 on `claude-haiku-5-5` | difference | verdict |
|---|---|---|---|---|
| LangChain | 50% | 83% | +33 points (95% interval -6 to +72), p = 0.45 | PROMISING |
| Strands | 42% | 100% | +58 points (+26 to +91), p = 0.016 | PROVEN at 1.8x the cost per case |

Held-out trials passed by rule, baseline to winner (Strands): cite 0/4 to 4/4, security 0/4 to 4/4, nopolicy 0/6 to 6/6; verify, lookup and ticket stayed at all passing.

In LangChain the rewrite got the security rule wrong. From the failures it saw it wrote "urgent: an active security exposure happening now" and "high: other security issues (phishing, lost device)", where the house rule is that every security incident is urgent. On the cases it learned from that still scored 90%. On the held-out cases five cases improved and two got worse: an email posing as the CEO and a USB stick found in the parking lot were both filed as `high`.

Time for the first run of each: 281 and 247 seconds.

## Codex arm

Both sessions did the same things in the same order, without being told: loaded the skill and three of its references, read `hone.config.ts`, listed the project while leaving `evals/` out ("the hone workflow forbids opening evaluation cases directly"), measured with `hone_test`, called `hone_sharpen` with `budget: 0`, read the diagnosis page, wrote change files, and called `hone_sharpen` again. Neither opened the case files.

**First cycle.** Each session wrote one change per failure mode, as the skill says: three or four prompts, each the old prompt plus one rule. On the cases they learned from:

| LangChain (baseline 50%) | | Strands (baseline 52%) | |
|---|---|---|---|
| cite policy IDs in brackets | 71% | cite policy results in brackets | 69% |
| open low-priority ticket when policy is missing | 62% | complete ticket escalation | 62% |
| escalate security incidents urgently | 62% | complete security escalation | 60% |
| create requested support tickets immediately | 50% | | |
| variant `model: sonnet` | 62% | variant `model: sonnet` | 62% |
| `model: sonnet` on the citation rule | 77% | `model: sonnet` on the citation rule | 75% |

Each rule fixed its own failure mode and nothing else. A `text` replaces the whole prompt, so the cycle could not put two of them together. The best single rule with the larger model went to the held-out check: 42% to 67% (p = 0.38) and 33% to 67% (p = 0.13). PROMISING both times.

**Second cycle.** Both sessions read that verdict, merged their rules into one prompt by hand, and ran the cycle again. hone raised the bar, because the held-out cases were now judging a second change: p < 0.025.

| | learned from | held-out | difference | verdict |
|---|---|---|---|---|
| LangChain | 50% to 94% | 42% to 96% | +54 points (+23 to +86), p = 0.016 | PROVEN at 1.1x the cost |
| Strands | 52% to 92% | 33% to 83% | +50 points (+7 to +93), p = 0.07 | PROMISING |

The larger model on top of the merged prompt added nothing in either (94% and 92% again).

In Strands the merged prompt said "Complete the escalation now rather than asking permission to create a ticket." On a held-out case, an employee who needs a password reset "right now" and gives no employee ID, the agent with the old prompt asked for the ID in both trials. With the new prompt it called `reset_password` in both. Seven held-out cases improved and this one got worse. That is what kept the verdict at PROMISING.

What the sessions did with the verdicts: the LangChain session applied the proven prompt to `hone.config.ts`, deleted its change files and measured again (68 of 72 trials on all 36 cases, from 34). The Strands session left the project as it was and reported: "Because this was the second distinct candidate judged by the same holdout set, hone required `p < 0.025`; it achieved `p = 0.07`. Following hone's rules, I left the candidate ready under `sharpen/` but did not modify the production prompt. New evaluation cases are needed before it can be responsibly shipped."

543 and 503 seconds; 11 and 6 shell commands; 5 and 4 MCP calls; 967k and 621k input tokens (925k and 586k of them cached), 5.3k and 4.4k output tokens.

## What the first runs got wrong

The benchmark was run to find this out. Each item was fixed and then checked on the same projects.

1. **The winner cost 4.7 to 4.9 times the baseline, and nobody had asked for that.** The larger model helps a little on its own (54% to 62%), so it won the first round, and every rewrite was then written and measured on top of it. Both model arms confirmed "rewrite 2 on `model: sonnet`": PROMISING in LangChain (50% to 92%, p = 0.13), PROVEN in Strands (42% to 100%). Whether the prompt needed the larger model was never measured. It did not: 90% against 92%, 98% against 100%. Now a winning rewrite that sits on a config change is tried without it (#119), and a candidate that costs clearly less and is within one standard error of the best is the winner (#122). Run again on the same projects, with the search answered from the cache, the cycle chose the prompt on the small model; the table above shows those verdicts.
2. **Changes to a text could not be combined.** Two sessions wrote one rule per change, and the cycle could only pick the best one. `change(name, { why, add })` is now a paragraph for the text as it is, and the additions that help are stacked (#121). Replayed in the Strands project with Codex's three paragraphs turned into additions word for word: 69%, 62% and 60% alone, 79% for two, 92% for three, in one cycle and with nobody merging anything. That is the pass rate of the prompt the session had merged by hand. The held-out check said the same as for the hand-merged prompt: 33% to 79%, p = 0.07, and the same password reset without verification. This replay edited Codex's files mechanically and was the third change judged by the same held-out cases; it shows the stacking, and it proves nothing new about the prompt.
3. **Spend was counted twice.** A rewrite runs on a sample first and its full run takes those answers from the cache; both were added to the spend at full price. `--max-cost 4` stopped both model arms after three candidates at a reported 3.9 dollars when 2.9 had been spent (#120).
4. **A proposer other than hone's model could not have its own changes judged alone** when the agent under test needs the API key: with a key reachable, the model always wrote rewrites too. `hone sharpen --no-rewrites` and `hone serve mcp --no-rewrites` (#117, #118).
5. **The python target, in a real project** (#115): editing the agent left cached answers in place; a `print` in the agent could be taken for its answer; a framework's warnings went into hone's output; `PYTHONPATH` was ignored; a script that used a target stayed alive for two minutes.

Not fixed: the search still measures a costlier variant alone and on top of each best text, and writes rewrites on top of it when it leads (see Spend). hone does not record what its own model calls cost. `hone init` registers the MCP server for Claude Code and Cursor, not for Codex, which needed `-c mcp_servers.hone...` and a pre-approved tool mode to call it without a person. The skill's main path is the CLI, which a sandboxed agent cannot use to run an agent that calls a model; both sessions went to the `mcp` reference by themselves, after being told the shell had no network.

## What this shows and what it does not

- **The path works on a real custom agent.** An agent built with a framework, wired in with one function, measured by rules written as cases, improved by a model or by a coding agent, and judged on cases neither had seen.
- **The held-out check earned its place.** Two of four prompts scored 90% and 92% on the cases they were written from and each had a fault those cases did not show: a wrong priority rule, and a password reset without verification. Both were stopped at PROMISING. A team looking at "52% to 92%" would have shipped the second one.
- **The proposer did not need to be hone's model.** Codex, with the skill and one request, wrote changes that reached the same pass rates. It never opened the case files, and it kept to the verdict when the verdict was no.
- **Twelve held-out cases are few, and they are not independent.** The cases of one rule pass or fail together, so the paired tests, which count each case as one piece of evidence, are more confident than they should be. Counted as six rules, of which four could improve, nothing here could be called proven. What was tested is whether a prompt carries over to unseen requests of the kinds it was written for, not to new kinds of request.
- **One run per arm.** The agent and both proposers are stochastic. That LangChain was proven with Codex and Strands with hone's model says nothing about frameworks or proposers; the next run may swap them.
- **The baseline is a one-line prompt.** Most of the gain is four rules that were written nowhere. An agent with a prompt that has been worked on has less to gain, and this benchmark does not measure how much.
- **The author of hone wrote the agent, the rules, the cases and the scorers**, and the scorers are literal: a substring in the answer, a tool name, an argument value.
- **The replays in "What the first runs got wrong" were not planned in advance.** They reuse projects whose held-out results had been seen by the person changing the tool. hone raised the bar for each new winner (p < 0.025, then p < 0.017); that accounts for the cases, not for the person.

## Spend

API credit, measured from the trials that ran (an answer from the cache costs nothing):

| | first run | follow-up and replay | total |
|---|---|---|---|
| LangChain, model arm | $3.46 | $0.49 | $3.95 |
| Strands, model arm | $3.61 | $0.57 | $4.18 |
| LangChain, Codex arm | $3.92 | | $3.92 |
| Strands, Codex arm | $3.88 | $1.45 | $5.33 |

$17.38 for the agent under test, 1,752 agent runs with no errors. hone's own model calls (naming failure modes in 13 runs, four rewrites) are not recorded; about $0.60 by token count. The Codex sessions ran on a ChatGPT subscription.

$12.04 of the $17.38 (69%) went to trials on the larger model, which the example offers as a variant: measured alone in every arm, put on top of the best text in every cycle, and under every rewrite of the first two runs. The fixes above change which candidate wins, not what the search pays to look at it.

## Reproduce

```bash
cd examples/helpdesk-agent && uv sync && cd ../..
export ANTHROPIC_API_KEY=...            # or put it in ~/.config/hone/env
benchmarks/custom-agents/project.sh strands /tmp/helpdesk-strands
benchmarks/custom-agents/model.sh /tmp/helpdesk-strands /tmp/out-model     # hone's model proposes
benchmarks/custom-agents/project.sh strands /tmp/helpdesk-strands-codex
benchmarks/custom-agents/codex.sh /tmp/helpdesk-strands-codex /tmp/out-codex   # Codex proposes
benchmarks/custom-agents/summarize.py /tmp/helpdesk-strands                # candidates, held-out by rule, spend
```

The ledgers, diagnosis pages, accounts, Codex event logs and the change files Codex wrote are in [`benchmarks/custom-agents/results/`](../../benchmarks/custom-agents/results/).
