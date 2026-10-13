// A change: one idea to try, with the reason. `hone sharpen` evaluates every change under sharpen/.
// A person wrote this one; a coding agent that read the diagnosis writes the same kind of file.
import { change } from "../../../src/index.ts"; // in your project: from "hone-eval"
import { STYLE, withBot } from "../bot.ts";

change("loose matching", {
  why: "questions with extra words around them find nothing, because they are matched word for word",
  config: (c) => withBot(c, String(c.targets.bot?.style ?? STYLE), true),
});
