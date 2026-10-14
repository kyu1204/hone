# sharpen

The three commands end to end, on a toy that needs no API key to run: a help-desk bot (`bot.ts`) that looks an answer up and words it the way a style text says.

```bash
cd examples/sharpen
hone test       # 18 cases, none passes
hone sharpen    # finds why, tries changes, confirms the best one on cases it never learned from
```

Two things are wrong with the bot. The style text asks for full sentences while the cases expect the bare answer, and questions are matched word for word, so a messy phrasing finds nothing.

A change is a file under `sharpen/`: one idea to try, with the reason. This one ships with the example:

```ts
// sharpen/loose-matching.ts
import { change } from "hone-eval";
import { STYLE, withBot } from "../bot.ts";

change("loose matching", {
  why: "questions with extra words around them find nothing, because they are matched word for word",
  config: (c) => withBot(c, String(c.targets.bot?.style ?? STYLE), true),
});
```

It fixes nothing while the style is wrong. This is what `hone sharpen` printed with `ANTHROPIC_API_KEY` set (15 seconds, four model calls):

```
Now: 0% of 12 cases pass. 6 more cases are held out for the final check.
Why it fails:
  1. unwarranted-refusal-idk (6 of 12 failed trials, e.g. cancel)
     The assistant gives a generic 'Sorry, I do not know' reply instead of attempting the task, s...
  2. boilerplate-answer-wrapper (5 of 12 failed trials, e.g. ship-abroad)
     The assistant wraps its answer in a fixed conversational template (e.g. "Thanks for asking!...
  3. conversational-filler-wrapping (1 of 12 failed trials, e.g. shipping-time)
     The assistant surrounds the answer with pleasantries or framing such as 'Thanks for asking!...
  Examples of each, and how to write a change: .hone/sharpen/20261013151659-diagnosis.md
Tried 3 changes:
  - loose matching               0% -> 0%   questions with extra words around them find nothing,...
  + rewrite 1                    0% -> 50%   Forbids refusals and boilerplate wrappers, and tells...
  + loose matching on rewrite 1  0% -> 100%
Result: PROVEN. On 6 cases it never saw, loose matching on rewrite 1 takes the pass rate from 0% to
100% (+100 points, 95% interval +100 to +100, p = 0.03).
The new text is in .hone/sharpen/20261013151659-best.txt
As a change file: .hone/sharpen/20261013151659-best.ts
It uses the change "loose matching" from sharpen/loose-matching.ts.
```

Six of the 18 cases were held out before anything was tried, and no proposal saw them. The model wrote `rewrite 1`; hone put the change from the file on top of it on its own. Six improvements out of six is the fewest an exact test accepts at the 5% level, which is why the verdict is PROVEN with p = 0.03 and not more.

Run it again and the model writes a different rewrite. That is a second question to the same six cases, so the bar rises to p < 0.025 and six out of six no longer clears it: the verdict becomes `PROMISING`, and the account says why. `rm -rf .hone` starts over; a real project adds cases.

## Write the text yourself

The rewrite does not have to come from a model. Add a second change and no key is needed:

```ts
// sharpen/terse-answers.ts
import { change } from "hone-eval";

change("answer with the bare value", {
  why: "the cases expect the answer alone; the bot wraps it in a sentence",
  text: "Reply with only the answer.",
});
```

`hone sharpen` then tries both changes alone, puts the one on the other, and ends `PROVEN` the same way. `hone.config.ts` says where a text goes (`sharpen.text`); a `config` change needs nothing declared.

In your own project import from `hone-eval` instead of `../../src/index.ts`.
