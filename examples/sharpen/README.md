# sharpen

The three commands end to end, on a toy that needs no API key to run: a help-desk bot that looks an answer up and words it the way a style text says.

```bash
cd examples/sharpen
hone test       # 18 cases, none passes
hone sharpen    # finds why, tries changes, confirms the best one on cases it never learned from
```

Two things are wrong with the bot. The style text asks for full sentences while the cases expect the bare answer, and questions are matched word for word, so a messy phrasing finds nothing. `hone.config.ts` tells hone what it may change:

```ts
sharpen: {
  text: { seed: STYLE, apply: (c, text) => withBot(c, text, c.targets.bot?.loose === true) },
  variants: { "loose matching": (c) => withBot(c, String(c.targets.bot?.style ?? STYLE), true) },
},
```

Loose matching alone fixes nothing while the style is wrong. This is what `hone sharpen` printed with `ANTHROPIC_API_KEY` set (16 seconds, four model calls):

```
Now: 0% of 12 cases pass. 6 more cases are held out for the final check.
Why it fails:
  1. blanket-refusal-unknown (6 of 12 failed trials, e.g. cancel): The assistant answers the task with a generic 'Sorry, I do not know.' instead of attempting the task or pro...
  2. chatty-preamble-wrapper (5 of 12 failed trials, e.g. ship-abroad): The assistant wraps the answer in conversational filler (e.g. a thank-you opener and 'The answer is ...') i...
  3. chatty-answer-wrapper (1 of 12 failed trials, e.g. shipping-time): The agent wraps the answer in conversational filler (e.g. a pleasantry opener or full-sentence framing) ins...
Tried 3 changes:
  - variant loose matching               0% -> 0%
  + rewrite 1                            0% -> 50%   Replaces the polite full-sentence instruction, which caused chatty wrappers, with a bar...
  + variant loose matching on rewrite 1  0% -> 100%
Result: PROVEN. On 6 cases it never saw, variant loose matching on rewrite 1 takes the pass rate from 0% to 100%
(+100 points, 95% interval +100 to +100, p = 0.03).
The new text is in .hone/sharpen/20261013122857-best.txt
It uses the variant "loose matching" from sharpen.variants.
```

Six of the 18 cases were held out before anything was proposed, and no proposal saw them. Six improvements out of six is the fewest an exact test accepts at the 5% level, which is why the verdict is PROVEN with p = 0.03 and not more.

Without a key the cycle still runs. It tries the variant, which needs no model, reports `NO GAIN`, and says that rewrites were not tried.

In your own project import from `hone-eval` instead of `../../src/index.ts`.
