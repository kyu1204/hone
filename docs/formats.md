# Formats

hone's own transcript is Docent/OpenAI-compatible `ChatMessage[]` plus `Span[]` (`llm | tool | retrieval | agent | custom`), so most imports and exports are field renames. Sources and decisions for every format are recorded with dates in [`compat.md`](./compat.md).

## Import: `hone import <kind> <path>`

| kind | input | becomes |
|---|---|---|
| `claude-code` | session JSONL files, or the project directory under `~/.claude/projects/` | one case (first human prompt) and one trace per session, with cost, tools, and diff/files artifacts from Edit/Write calls |
| `inspect` | JSON from `inspect log dump` | one trace per sample per epoch; `C`/`I`/`P` scores mapped to pass/fail/undecided |
| `docent` | an AgentRun, an array, or `{ agent_runs }` | one trace per run; `metadata.scores`, `model`, `task_id` |
| `plugin-eval` | a `claude plugin eval` case directory | cases plus hone scorer specs from `graders/*.md` (no trials) |
| `harbor` | a trial or job directory | `results.json` plus the ATIF trajectory; verifier reward as the score |
| `otel` | OTLP JSON | one trace per trace id; spans by `gen_ai.operation.name`, scores from `gen_ai.evaluation.result` events |

Each import creates one run so the TUI shows the trials immediately.

## Export: `hone export <kind> [--run id] [--out path]`

| kind | output |
|---|---|
| `rollouts` | JSONL `{ prompt, completion, reward, info }` (`--format openai` gives `{ messages, reward, info }`); `--reward pass | mean-score | <scorer>` |
| `otel` | OTLP JSON: one `invoke_agent` root span per trial with messages and one evaluation event per score, child spans by kind |
| `docent` | `{ agent_runs: [...] }` |
| `junit` | one testcase per (case, target) cell |
| `html` | self-contained report (`hone test --report` writes it right after a run) |

The OpenTelemetry attribute names live in one file, `src/io/otelAttrs.ts`, with the semantic-conventions commit they were read from.
