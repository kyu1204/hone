# Demonstration: a coding agent writes the changes

Date: 2026-10-13. Status: **one session.** This is a demonstration that the path works end to end, not a benchmark. Result in one line: Claude Code, given a one-sentence request and the skill `hone init` installs, read the diagnosis page, wrote two change files, and `hone sharpen` confirmed the pair on six held-out cases (0% to 100%, p = 0.03) with no model of its own to help.

## Setup

- **Project**: a stand-alone copy of [`examples/sharpen`](../../examples/sharpen/), a toy help-desk bot in which no case passes. The change file that ships with the example was removed, and so were the comments that explain what is wrong with the bot.
- **hone**: installed as a package in the project, with the skill from `hone init --skills` in `.agents/skills/hone` and `.claude/skills/hone`. No API key was reachable by hone, so it could not name failure modes or write rewrites: the only source of changes was whoever wrote files under `sharpen/`.
- **Agent**: Claude Code 2.1.296, `claude-sonnet-5-5`, headless, project settings only, no MCP servers, the OS sandbox with no network and no reads outside the project, tools Bash, Edit, Write, Read, Glob, Grep and Skill.
- **The only instruction**: "This project has a help-desk bot (bot.ts) that customers complain about. Use hone to find out what is wrong with it and make it better. Then tell me what you found and what hone's verdict is."

## What the agent did

31 seconds, 14 turns, 169k input tokens and 2.9k output tokens.

1. Loaded the `hone` skill.
2. Read `bot.ts` and `hone.config.ts`.
3. Ran `hone test`: 0 of 18.
4. Ran `hone sharpen --budget 0` and read the diagnosis page it named.
5. Wrote two change files, one hypothesis each:

   ```ts
   // sharpen/bare-answers.ts
   import { change } from "honed";

   change("answer with the bare value", {
     why: "clusters 2 and 3: the bot wraps the fact in 'Thanks for asking! The answer is ...' but the cases expect the value alone",
     text: "Reply with only the answer.",
   });
   ```

   ```ts
   // sharpen/loose-matching.ts
   import { change } from "honed";
   import { withBot } from "../bot.ts";

   change("match questions loosely", {
     why: "cluster 1: reworded questions ('ok so... how do I cancel my order again') miss the exact-match lookup and get 'Sorry, I do not know.'",
     config: (c) => withBot(c, String(c.targets.bot?.style), true),
   });
   ```

6. Ran `hone sharpen`. From the ledger:

   | candidate | source | cases it learned from |
   |---|---|---|
   | answer with the bare value | file | 0% to 50% |
   | match questions loosely | file | 0% to 0% |
   | match questions loosely on answer with the bare value | file, paired by hone | 0% to 100% |

   Verdict: `PROVEN`. On the 6 held-out cases the pair took the pass rate from 0% to 100%, p = 0.031, the first confirmation on that held-out set.
7. Applied the two changes to `bot.ts` and `hone.config.ts` after the verdict, re-ran `hone test` (18 of 18), and reported the verdict with three caveats of its own: six held-out cases is a small sample, the scorer is exact match, and substring matching could mis-hit.

It did not open the case files, did not edit a file the baseline runs before the verdict, and did not touch cases or scorers.

## What this shows and what it does not

- The interface holds: an agent that has only the skill writes the same kind of file a person writes, and the cycle treats it the same. The agent never decided to combine its two changes; hone tried the one on top of the other.
- hone's part was the check, not the idea. The faults of this toy are easy to read in `bot.ts`, and the agent could have edited the file directly. What the cycle added is that the fix was confirmed on cases the agent was not shown, and that the setting which looked useless alone (0% to 0%) was still found to matter.
- One session on a toy says nothing about harder systems, about agents that ignore the skill, or about whether an agent resists tuning against the case files when the fix is not obvious. The agent-harness study next to this one ([`agent-harness.md`](./agent-harness.md)) showed how readily an agent reads what it can reach.
