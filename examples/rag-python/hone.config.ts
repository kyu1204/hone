// RAG over HTTP: the service returns the answer plus the retrieved chunks; hone scores retrieval and citations.
import { defineConfig } from "../../src/index.ts"; // in your project: from "hone-eval"

const url = `${process.env.RAG_URL ?? "http://127.0.0.1:8000"}/ask`;

export default defineConfig({
  targets: {
    rag: { kind: "http", url, body: (c) => ({ q: c.input }), output: "answer", version: "rag-python-0.1" },
  },
  cases: "evals/*.yaml",
  trials: 1,
  scorers: [
    { name: "rag.context_recall", caseField: "expected.chunks" },
    { name: "rag.citations" },
    { name: "contains", caseField: "expected.answer" },
  ],
  gates: { passAt1: { min: 1 } },
});
