---
name: hone
description: Evaluates an AI system (a RAG pipeline, an agent, an LLM endpoint, a coding-agent harness) and improves it with proof, using hone. Use when asked to measure quality, find why cases fail, make the system better, compare two versions, or check that a change really helped. Covers writing cases, reading the diagnosis, writing change files under sharpen/, running the cycle and reporting its verdict.
---

# hone: evaluate, then sharpen

hone runs every case against the system several times, scores each run, and says how far to trust the score. `hone sharpen` then tries changes and keeps only what holds up on cases no change was allowed to see. Four commands cover the normal path:

```bash
hone init       # once: writes hone.config.ts, example cases, this skill, the MCP registration
hone draft      # cases: drafted from the agent's prompt and code, run once, failures reported
hone test       # evaluate: pass rate per case, with trials and intervals
hone sharpen    # improve: why cases fail, each change tried, a verdict on held-out cases
```

## Start here: pick the reference for the job

Read the one reference that matches the request before doing anything else. `hone guide <topic>` prints the same text.

| When you are | Topic | Read |
| --- | --- | --- |
| Adding hone to a project, pointing a target at the system, storing keys | `setup` | [references/setup.md](references/setup.md) |
| Writing or fixing cases and scorers, deciding how many cases are enough | `cases` | [references/cases.md](references/cases.md) |
| Asked to improve the system: reading the diagnosis, writing change files, running the cycle | `sharpening` | [references/sharpening.md](references/sharpening.md) |
| Reading a result, deciding what you may claim, reporting to the user | `results` | [references/results.md](references/results.md) |
| Needing one step on its own: compare two targets, look at one trial, cluster failures, check a judge | `steps` | [references/steps.md](references/steps.md) |
| Working through the MCP server instead of a shell | `mcp` | [references/mcp.md](references/mcp.md) |

The full documentation ships in the `docs/` directory of the installed package (`node_modules/hone-eval/docs`).

## Workflow: improving a system

1. Look at what exists: `hone.config.ts`, the cases (`evals/`), the changes already tried (`sharpen/`). No config: follow `setup`.
2. No cases yet, or too few: `hone draft` has hone's model read the agent's prompt and code, draft cases into `evals/drafted.yaml`, run them once and say which fail (`--read <file>` for the files that define the agent). Read the drafts and delete the ones that do not describe what the agent should do; they are proposals, like change files. Or write cases yourself (topic `cases`).
3. Measure: `hone test`. If the system errors, fix that first; an error is not a wrong answer.
4. Read why cases fail: `hone sharpen --budget 0` measures, diagnoses and names a page, `.hone/sharpen/<id>-diagnosis.md`. Read that page. It shows each failure mode with failing cases in full.
5. Write one change per hypothesis as a file under `sharpen/` (topic `sharpening`):
   ```ts
   // sharpen/terse-answers.ts
   import { change } from "hone-eval";

   change("answer with the bare value", {
     why: "the cases expect the answer alone; the bot wraps it in a sentence",
     add: "Reply with only the answer.",
   });
   ```
   `add` is one paragraph for the text as it is; hone stacks the additions that help into one text. `text` replaces the whole text.
6. Run the cycle: `hone sharpen`. It tries every change, pairs changes that only help together, and checks the best one on the held-out cases.
7. Report the `Result:` line as printed, with what was tried. Apply a change to the project only when the verdict is `PROVEN`, or when the user decides otherwise knowing the verdict. After applying one, delete its file from `sharpen/`: it is now part of the system and would only be tried against itself.

## Rules

- Run the CLI as `hone ...` (`bunx hone-eval ...` when it is not installed in the project).
- One hypothesis per change, and say it in `why`. A change that does three things cannot tell you which one helped. For a text, that means one `add` per rule: do not write one big text yourself, hone puts the additions together and shows what each was worth.
- Never edit a file the current system runs. Put new code in a new file and point the change's `config` function at it. If the baseline changes too, there is nothing left to compare against.
- Do not open the case files to tune against them, and never copy a case's expected answer into a prompt or into code. A third of the cases is held out for the final check; the diagnosis page shows you the ones you may learn from.
- Do not edit cases or scorers to make a change look better. If a case or a scorer is wrong, say so and fix it as its own step, then measure again from the start.
- `PROMISING, not proven` is not an improvement. Say what the account says: how many more held-out cases would settle it.
- `NO GAIN` after a change looked better on the cases it learned from means it fitted those cases. Do not ship it.
- Report numbers from hone's output. Never estimate a pass rate from reading a few transcripts.
- `.hone/` is output. Read it, never edit it.
