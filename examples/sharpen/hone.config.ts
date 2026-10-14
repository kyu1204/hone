// The three commands end to end on an offline toy: hone test, then hone sharpen.
// The bot in bot.ts has two things wrong with it:
//   the style text asks for full sentences, while the cases expect the bare answer   -> sharpen.text says where a new text goes
//   questions are matched word for word, so a messy phrasing finds nothing           -> sharpen/loose-matching.ts proposes a fix
// Half of the 18 questions are asked plainly and half messily. Loose matching alone fixes nothing while the style is
// wrong, so hone has to find that the two changes belong together.
import { defineConfig } from "../../src/index.ts"; // in your project: from "hone-eval"
import { STYLE, withBot } from "./bot.ts";

const base = defineConfig({ targets: {}, cases: "evals/*.yaml", trials: 1, scorers: [{ name: "exact", normalize: "trim" }] });

export default defineConfig({
  ...withBot(base, STYLE, false),
  // the one text hone may rewrite, and how a new version of it gets into the config
  sharpen: {
    text: { seed: STYLE, apply: (c, text) => withBot(c, text, c.targets.bot?.loose === true) },
  },
});
