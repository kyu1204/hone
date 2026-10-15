# sharpen/

Changes for `hone sharpen` to try: one idea per file, with the reason. A person writes them, or a coding agent that
read why cases fail (`hone sharpen --budget 0` names that page).

```ts
// sharpen/first-idea.ts
import { change } from "hone-eval";

change("what it does", {
  why: "which failure it fixes, and why",
  add: "one rule for the text",            // a paragraph added to the text declared in sharpen.text
  // text: "the whole new text",           // or a new version of the whole text
  // config: (config) => ({ ...config }),  // or a change to the config: a setting, a model, new code
});
```

Additions that help are stacked into one text, so two rules are two changes. Never edit a file the current system
runs. Put new code in a new file and point `config` at it.
