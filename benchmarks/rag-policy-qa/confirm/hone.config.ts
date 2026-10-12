// Confirmatory comparison: baseline vs the authors' best (v3-k30) vs the best evolved prompt, 3 trials each, one run so compare is paired.
import * as fs from "node:fs";
import * as path from "node:path";
import { defineConfig } from "../../../src/index.ts";
import { gradeRag, ragTarget } from "../hone.config.ts";

const evolveDir = path.join(import.meta.dir, "..", ".hone", "evolve");
let evolved: { text: string; id: string } | undefined;
if (fs.existsSync(evolveDir)) {
  const files = fs.readdirSync(evolveDir).filter((f) => /^\d+\.json$/.test(f)).sort();
  const latest = files.at(-1);
  if (latest) {
    const file = JSON.parse(fs.readFileSync(path.join(evolveDir, latest), "utf8")) as { candidates: { id: string; text: string; passAt1: number; rejected?: string }[] };
    const best = file.candidates.filter((c) => !c.rejected && c.text).sort((a, b) => b.passAt1 - a.passAt1)[0];
    if (best) evolved = { text: best.text, id: `${latest.replace(".json", "")}-${best.id}` };
  }
}

export default defineConfig({
  targets: {
    baseline: ragTarget({}, "confirm-baseline"),
    "v3-k30": ragTarget({ RAG_PROMPT: "v3", TOP_K: "30" }, "confirm-v3-k30"),
    ...(evolved ? { evolved: ragTarget({ HONE_RAG_PROMPT: evolved.text, TOP_K: "30" }, `confirm-${evolved.id}`) } : {}),
  },
  cases: "../cases.json",
  trials: 3,
  concurrency: 1,
  scorers: [{ name: "fn", id: "grade", score: gradeRag }],
});
