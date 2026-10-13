# Correction

The point of measuring is to change something and know whether it helped. Every command here ends with a paired verdict and says `no measurable effect` when the data do not support a claim.

## The whole cycle: `hone sharpen`

One command for what the rest of this page does step by step. What it tries are **changes**, each a file under `sharpen/` that calls `change()`:

```ts
// sharpen/terse-answers.ts
import { change } from "hone-eval";

change("answer with the bare value", {
  why: "the cases expect the answer alone; the bot wraps it in a sentence",
  text: "Reply with only the answer.",
});
```

- `why` is required: the hypothesis. It goes into the ledger and the account.
- `text` is a new version of the one text the config declares in `sharpen.text` (`seed` and `apply`, which says where a text goes).
- `config` is a function from a config to a config: a setting, a model, another function or module for a target. New code lives in a new file, or in the change file, and the config points at it. Never edit a file the baseline runs: there would be nothing left to compare against.
- A change has a `text`, a `config`, or both. `config.sharpen.changes` moves the directory (a glob; default every `.ts`, `.js` and `.mjs` file under `sharpen/`).

Variants declared inline in `sharpen.variants` are config changes without a file, and with `sharpen.text` and an LLM key a model writes rewrites too. A model's winning rewrite is saved as `.hone/sharpen/<id>-best.ts`, a change file like any other.

1. **Split.** A third of the cases is held out, chosen by a hash of `--seed` and the case id, so the split is the same on every run. Cases that declare the same `cluster` stay on the same side. Below 12 cases nothing can be held out.
2. **Measure** the unchanged config on the other cases.
3. **Gates.** It stops before proposing when more than 20% of the trials errored (`Cannot measure`: an error is not a wrong answer), when nothing fails (`Nothing to sharpen`), or when the config declares nothing to change (`Nothing to change`).
4. **Diagnose.** Failed trials are clustered; with an LLM key the clusters get names and definitions. The result is also written as a page for whoever writes the next change, `.hone/sharpen/<id>-diagnosis.md`: each failure mode with three failing cases in full (input, expected, output, the scorer's reason), what may change, and a change file to copy. It is built from the dev cases only. `hone sharpen --budget 0` stops here.
5. **Try,** at most `--budget` candidates. Every change from a file on its own, then every inline variant. Then, from the best candidate so far, whatever kind it lacks: a config change on top of a text, a text from a file on top of a config change. That is how changes that only help together are found. When nothing is left to pair and there is a model, a rewrite from the best candidate. A text runs on a sample (the failing cases plus eight passing ones) before it gets a full run.
6. **Confirm.** The baseline and the best candidate run on the held-out cases. `PROVEN` needs a positive difference that both a paired t test and an exact sign test call significant; six improvements out of six are the fewest that can. `PROMISING, not proven` comes with the number of held-out cases that would settle it. `NO GAIN` keeps the baseline. A held-out set wears out: the n-th different winner confirmed on the same held-out cases has to reach `alpha / n` (`.hone/sharpen/holdout.json` keeps the count; the same winner again keeps its place), and the account says so.

The account is printed in plain words with the statistics in parentheses. `.hone/sharpen/<id>.json` holds every candidate, including the dropped ones and why; a winning text is also written to `.hone/sharpen/<id>-best.txt`. See [`examples/sharpen`](../examples/sharpen/) for a run.

## Fork: `hone fork <trialId> --step N --content "..."`

Replaces one message of a stored trial and re-runs the target from that prefix (targets with `resume` continue the conversation; others receive the prefix in `ctx.prefix`). Prints the verdict change, the scores and the rows where the new trajectory diverges. Without `--step` it lists the ranked branch points. Forked trials carry a `forked-from:<id>` flag and never count in run totals.

## Evolve: `hone evolve`

GEPA-style text evolution over `config.sharpen.text.seed`:

1. Baseline run on all cases.
2. For each of `--budget` candidates: pick a parent from the Pareto front, show an LLM the parent text and up to six failure summaries, ask for a revised text as JSON.
3. Verify on a minibatch (every case the parent failed plus `--minibatch` passing cases); reject when the candidate is worse there.
4. Run accepted candidates on the full set; keep the Pareto front over pass@1 and cost.
5. Paired verdict of the best candidate against the baseline: `<id> beats baseline (+N pts, p=...)` or `no measurable effect`.

Writes `.hone/evolve/<id>.json` (candidates with intervals, cost, `pareto`, `rationale`, `rejected`) and the candidate texts next to it. `--max-cost` stops when the total spend is reached.

## Optimize: `hone optimize`

Thompson sampling over the `config.sharpen.variants` candidates plus `baseline`: each round allocates `--batch` trials by sampling from each arm's Beta posterior, runs them on the least-observed cells, and stops when `P(best) >= --confidence` (every arm having `--min-per-arm` trials) or at `--budget`. Then a verification top-up gives the baseline and the leader one trial on every case they have not seen, and a paired test over the shared cases decides. Writes `.hone/optimize/<id>.json`.

## Ablate: `hone ablate`

Runs the baseline and each `config.ablations` transform on the same cases and reports, per component, the paired delta with its interval and `component helps | component hurts | no measurable effect`.

## Bisect: `hone bisect --case <id> --good <rev> --bad <rev>`

Binary search over commits in git worktrees; each probe runs the case enough times to decide against the midpoint of the good and bad rates with Wilson intervals.

## Compare and CI

`hone compare <a> <b>` is the paired comparison (paired t with McNemar for binary outcomes, cluster-robust errors when cases declare `cluster`). `hone test --ci` runs and gates on `passAt1`, `passHatK`, `costUsd` and regression against `--baseline <runId>`, writes JUnit, and posts or prints a PR comment.
