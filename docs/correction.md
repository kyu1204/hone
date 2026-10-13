# Correction

The point of measuring is to change something and know whether it helped. Every command here ends with a paired verdict and says `no measurable effect` when the data do not support a claim.

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
