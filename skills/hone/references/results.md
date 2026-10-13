# results: what the output means and what you may claim

## hone test

One row per case, one column per target: `●` a passing trial, `○` a failing one, then the pass rate. The last line gives `pass@1` (the mean pass rate), `pass^3` (the chance that three trials in a row all pass), the number of trials, the cost and the tokens per solved case.

- A score from one trial is one sample. `trials` in the config, or `hone test --trials n`, repeats each case.
- A trial whose target errored is a failure caused by the system not running, not by a wrong answer. `hone matrix` counts errors in their own column.
- `hone test --ci` turns the gates in the config into an exit code, JUnit and a pull request comment.

## hone sharpen: the verdicts

| `Result:` | Meaning | What to do |
| --- | --- | --- |
| `PROVEN` | the best change beat the current system on the held-out cases, by a paired t test and an exact sign test | adopt it; report the line as printed |
| `PROMISING, not proven` | better on the held-out cases, but too few of them to rule out chance | do not call it an improvement; say how many held-out cases the account asks for |
| `NO GAIN ... looked better on the cases it learned from` | it fitted the cases it saw and did not carry over | do not ship it; the change encodes cases, not a cause |
| `NO GAIN. None of the n changes beat what you have` | nothing was better even on the cases it learned from | read the diagnosis again; the hypothesis was wrong |
| `Nothing to sharpen` | every case passes | add harder cases |
| `Nothing to change` | there is no change file, no variant and no model for rewrites | write a change (topic `sharpening`) |
| `Cannot measure` | more than a fifth of the trials errored | fix the system or the target first |

The statistics in parentheses are the difference in pass rate on the held-out cases, its interval, and the p-value. `Cost per case` compares what the changed system costs to run with what the current one costs.

## What you may claim

- Quote the `Result:` line. Do not round `PROMISING` up to "improved" or `NO GAIN` down to "about the same".
- A rise on the cases a change learned from (the `+` rows) is not evidence. Only the held-out check is.
- When too few cases are held out to prove anything (fewer than six), say that the suite is too small, not that the change does not work.
- Give the cost next to the gain when the account prints one.
- When the account says the held-out cases have judged several different changes, say so: the bar was higher for this one, and new cases restore it.

## Where things are

| Path | Content |
| --- | --- |
| `.hone/sharpen/<id>.json` | the ledger: the split, the baseline, the failure modes, every candidate with its source, reason and result, the confirmation |
| `.hone/sharpen/<id>-diagnosis.md` | the failure modes with failing cases in full |
| `.hone/sharpen/<id>-best.txt`, `<id>-best.ts` | a winning text written by the model, as text and as a change file |
| `.hone/runs/` | every trial: messages, spans, scores (`hone explain <trialId>`) |
