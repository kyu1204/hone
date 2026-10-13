# cases: what the system is checked against

Cases are YAML, JSON or JSONL files matched by `cases` in the config (default `evals/**/*.yaml`). One case:

```yaml
- id: return-window
  input: What is the return window?
  expected: 30 days
  tags: [plain]
  cluster: returns        # optional: cases that are versions of one question
```

| Field | Meaning |
| --- | --- |
| `id` | unique, stable; results are keyed by it |
| `input` | what the target receives: a string or any JSON value |
| `expected` | what a scorer compares against (optional for rubric and judge scorers) |
| `rubric` | instructions for a judge scorer |
| `tags` | for `hone test --tag` |
| `cluster` | cases that share one fact, document or question. They are held out together and count as one piece of evidence |

## How many

- `hone sharpen` holds a third of the cases out. Below 12 cases it cannot, and the best verdict is `PROMISING`.
- Six held-out improvements out of six is the fewest an exact test accepts at the 5% level. That needs 18 independent cases, and more when a change does not fix every case.
- Prefer more cases over more trials when the cases differ from each other; trials only measure how stable one case is.
- Near-duplicates are not extra evidence. Give them the same `cluster`.

## Scorers

A scorer turns a trial into `{ value, pass, reason }`. A trial passes when no scorer fails and at least one passes. Use a deterministic scorer wherever one can decide: `exact`, `contains`, `regex`, `json-schema`, `tool_used`, `test_command` and others. RAG scorers read the retrieval spans (`rag.citations`, `rag.faithfulness`, ...). Judges (`jev.*`, `llm.rubric`) are for what only a reader can decide; check one before trusting it with `hone calibrate --scorer <name>` (topic `steps`). The full list with options is in `docs/config.md` of the package.

## When a case or a scorer is wrong

Fix it as its own step, say so to the user, and measure again from the start. Never change cases or scorers in the same step as a change to the system: the comparison would mean nothing.
