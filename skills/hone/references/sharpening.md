# sharpening: making the system better, with proof

`hone sharpen` runs one cycle: it holds a third of the cases out, measures the system on the rest, finds why cases fail, tries changes, and checks the best one on the held-out cases. You supply the changes.

## 1. Read the diagnosis

```bash
hone sharpen --budget 0
```

This measures, diagnoses and tries nothing. It prints the failure modes and names a page:

```
Why it fails:
  1. chatty-answer-wrapper (5 of 12 failed trials, e.g. ship-abroad): The assistant wraps the answer in ...
  Examples of each, and how to write a change: .hone/sharpen/<id>-diagnosis.md
```

Read that page. For each failure mode it shows three failing cases in full (input, expected, output, the scorer's reason), then what may change and a change file to copy. It is built only from cases you may learn from.

## 2. Write changes

A change is a file under `sharpen/` that calls `change()`. One hypothesis per call.

```ts
// sharpen/terse-answers.ts
import { change } from "hone-eval";

change("answer with the bare value", {
  why: "the cases expect the answer alone; the bot wraps it in a sentence",
  text: "Reply with only the answer.",
});
```

| Field | Meaning |
| --- | --- |
| name (first argument) | short and unique; it appears in the result |
| `why` | required: which failure mode, and why this fixes it |
| `text` | a new version of the text the config declares in `sharpen.text`. The whole text, not a diff |
| `config` | a function from a config to a config: a setting, a model, another function or module for a target |

A change has a `text`, a `config`, or both. A `text` needs `sharpen.text` in the config (topic `setup`).

### Changing code

A change never edits a file the current system runs. Write the new version beside the old one and point the config at it:

```ts
// sharpen/rerank.ts
import { change } from "hone-eval";
import { answerWithRerank } from "../src/answer-rerank";   // a new file

change("rerank the retrieved chunks", {
  why: "the right chunk is retrieved but ranked below the cut in 7 of 12 failures",
  config: (config) => ({ ...config, targets: { ...config.targets, rag: { kind: "fn", fn: answerWithRerank } } }),
});
```

For a `python` or `process` target the function returns the same target with another module, command or workspace. If you edit the file the baseline imports, the baseline changes too and the comparison is gone.

### Good changes

- Aim at one failure mode from the diagnosis and name it in `why`.
- Fix the cause the failing cases show, not the cases. A prompt that lists the expected answers of the cases you saw passes those cases and fails the held-out ones; the verdict will be `NO GAIN`.
- Keep what already works. The cycle checks a new text on the failing cases plus some passing ones before it spends a full run on it.
- Two ideas are two changes. The cycle puts changes together itself when one only helps on top of another.

## 3. Run the cycle

```bash
hone sharpen                 # every change, pairings, then the held-out check
hone sharpen --budget 10     # try at most 10 candidates (default 6)
hone sharpen --until 0.9     # stop trying once 90% of the cases it learns from pass
hone sharpen --max-cost 2    # stop trying when the system under test has cost 2 dollars
```

Order of candidates: every change from a file alone, then inline variants from the config, then pairings on top of the best one so far, then (with an LLM key and `sharpen.text`) rewrites by a model. Raise `--budget` when there are more changes than the default covers.

## 4. Read the result

```
Tried 3 changes:
  - loose matching               0% -> 0%   questions with extra words around them find nothing...
  + rewrite 1                    0% -> 50%   Replaces the polite full-sentence instruction...
  + loose matching on rewrite 1  0% -> 100%
Result: PROVEN. On 6 cases it never saw, loose matching on rewrite 1 takes the pass rate from 0% to 100%
(+100 points, 95% interval +100 to +100, p = 0.03).
```

`+` marks a candidate that beat the current system on the cases it learned from. Only the `Result:` line says whether it holds up (topic `results`). The full ledger, with every dropped candidate and why, is `.hone/sharpen/<id>.json`. A winning text written by the model is saved as `.hone/sharpen/<id>-best.ts`, a change file you can move into `sharpen/`.

## 5. Go around again, with care

The held-out cases wear out. Every different winner they judge leaks a little about them, so hone divides the level by the count: the second different change confirmed on the same held-out cases has to reach p < 0.025, the third p < 0.017. The account says when this applies. Running the same change again does not count. Write the next changes from the diagnosis, not from the last verdict, and add cases when the bar has moved out of reach.
