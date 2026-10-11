# Analysis

Everything here reads stored trials from `.hone/` and writes JSON next to them; the TUI screens read the same files.

## Failure clustering: `hone cluster`

Summarises each failed trial (error, failed scorer reasons, last assistant message, tools, flags), embeds the summaries (OpenAI-compatible `/embeddings` when a key is configured, otherwise a 512-dimensional hashed bag of words so it works offline), runs k-means++ with cosine distance, and names each cluster by its top TF-IDF terms.

`--induce` asks an LLM for a code, axis (`system | role | domain`), definition and evidence patterns per cluster, merges them with `.hone/taxonomy.json` (same code, or Jev agreement >= 0.8), then classifies every failed trial against the taxonomy with one Jev `choice` question each. `--classify` reuses the saved taxonomy.

Output: `.hone/analysis/clusters-<runId>.json`

```json
{ "schemaVersion": 1, "runId": "...", "codes": [{ "code": "timeout-no-progress", "axis": "system", "definition": "...", "evidencePatterns": ["exit code 124"], "count": 7, "trialIds": ["..."] }] }
```

## Trajectory diff: `hone diff <a> <b>`

Aligns two message lists by role and tool-call signature (LCS) and classifies every row as `identical`, `different-content`, `different-tool-args`, `missing-in-a` or `missing-in-b`. The TUI diff screen and the branch-point ranking use the same alignment.

## Judge calibration: `hone calibrate --scorer <name>`

Injects silent faults into passing trials and re-scores them with one scorer:

| domain | faults |
|---|---|
| rag | `unsupported-claim`, `wrong-citation` |
| qa | `answer-swapped`, `negated` |
| agent | `verification-removed`, `tool-result-swapped`, `premature-done` |

Reports the detection rate per fault with a Wilson interval, the false-alarm rate on clean trials, and Cohen's kappa against `--labels file.csv` (`trialId,true|false`). Output: `.hone/analysis/calibration-<scorer>.json`.

## Branch points

`hone explain <trialId>` and the fork screen rank the steps of a failed trace by how likely a fork there changes the outcome: tool error spans (+3), the first divergence from a passing sibling of the same case (+3), a tool result that differs from the sibling's (+2), the last tool call before the answer (+1), a completion claim with no tool call after it (+1), minus one for the first 20% of the trace. Ties go to later steps.
