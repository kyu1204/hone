# Compatibility notes

Resolved 2026-10-12 for work order T-009. Every claim carries its source and date. Later tasks follow the "Decision for hone" lines verbatim.

## 1. Harbor (Terminal-Bench runner)

Sources: https://github.com/harbor-framework/harbor (main, read 2026-10-12): `examples/tasks/describe-image/`, `src/harbor/models/trial/{result,paths}.py`, `src/harbor/models/verifier/result.py`, `src/harbor/models/job/result.py`, `docs-mintlify/agents/atif.mdx`, `examples/tasks/hello-load-atif-trajectory-run-level/environment/trajectory.json`.

**Task directory** (`task.toml` `schema_version = "1.1"`):

```
<task>/
  task.toml          [task] name/description/authors/keywords, [metadata] difficulty/category/tags,
                     [verifier] timeout_sec, [agent] timeout_sec,
                     [environment] build_timeout_sec/cpus/memory_mb/storage_mb/gpus/mcp_servers,
                     [verifier.env] [environment.env] [solution.env]
  instruction.md     the prompt given to the agent
  environment/       Dockerfile (+ assets)
  tests/test.sh      verifier; writes /logs/verifier/reward.txt or reward.json
  solution/solve.sh  optional reference solution
  persona.md         optional simulated-user persona
```

Container paths: `/logs/agent`, `/logs/verifier`, `/logs/artifacts`, `/tests`, `/solution`; reward at `/logs/verifier/reward.txt` or `reward.json`.

**Trial output** (`trial_dir/`): `config.json`, `lock.json`, `results.json` (= `TrialResult`), `agent/` (contains `trajectory.json` and `manifest.json`), `verifier/`, `artifacts/`. `TrialResult` fields: `id`, `task_name`, `trial_name`, `trial_uri`, `task_id`, `task_checksum`, `config`, `agent_info { name, version, model_info { name, provider } }`, `agent_result` (AgentContext with `n_input_tokens`, `n_cache_tokens`, `n_output_tokens`, `cost_usd`), `verifier_result { rewards: Record<string, number> | null }`, `exception_info`, timing blocks (`started_at`, `finished_at`, `environment_setup`, `agent_setup`, `agent_execution`, `verifier`), `step_results[]` for multi-step trials. Job stats include `pass_at_k`.

**Trajectory format**: ATIF, `agent/trajectory.json`, `schema_version` `ATIF-v1.0` to `ATIF-v1.7` (current 1.7). Shape: `{ schema_version, session_id, agent { name, version, model_name, extra }, steps[] }`, each step `{ step_id, timestamp, source: "user"|"agent"|"system", model_name?, message, tool_calls?: [{ tool_call_id, function_name, arguments, extra }], observation?: { results: [{ source_call_id, content, extra }] }, metrics?, extra }`. Validator: `python -m harbor.utils.trajectory_validator path`.

**CLI**: `harbor run -d "<dataset@version>" -m "<model>" -a "<agent>" [--n-concurrent N] [--env daytona|modal|...]`; `harbor datasets list`.

**Decision for hone**: T-107 runs a task directory by building `environment/Dockerfile`, mounting `tests/` at `/tests`, writing `instruction.md` as the first user message, reading `/logs/verifier/reward.txt|json` as the score. T-802 imports a trial dir: `results.json` for usage/cost/reward, `agent/trajectory.json` (ATIF) for messages: `source: user` to `user`, `source: agent` to `assistant` with `tool_calls[].function_name/arguments` mapped to OpenAI `tool_calls` (arguments JSON-stringified), each `observation.results[]` to a `tool` message with `tool_call_id = source_call_id`. T-803 can export ATIF-v1.7 from hone traces with the inverse mapping.

## 2. verifiers v1 (Prime Intellect)

Sources: https://github.com/PrimeIntellect-ai/verifiers (main, read 2026-10-12): `docs/v1/{overview,tasksets,evaluation,harbor}.md`, package `verifiers/v1/`.

- v0 (`import verifiers as vf`, Rubric/Parser/SingleTurnEnv) has been removed. v1 is `import verifiers.v1 as vf`.
- Concepts: `Taskset[TaskT, ConfigT]` with `load() -> list[Task]`; `Task[TaskData, State, TaskConfig]` with `@vf.reward async def name(self, trace: vf.Trace) -> float` (and `@vf.metric`); `TaskData(prompt=..., ...)` immutable row with optional `id` and `name`; `Harness` (Claude Code, Codex, mini-swe-agent, custom); `Agent` = harness x model x runtime policy producing a `Trace`; `Trace` holds the message graph, rewards, metrics, errors and per-call `ModelCall` records (model, sampling, finish reason, usage, timing); `trace.last_reply`.
- `HarborTaskset` wraps single-step Harbor 0.24.0 tasks; `HarborConfig.dataset = "<org>/<name>"`.
- `vf-eval <taskset>` writes `outputs/<env>--<model>--<harness>/<uuid>/` with `config.toml`, `traces.jsonl` (one episode per line), `logs/attempt_<n>/eval.log`; `--resume <dir>` re-runs missing or errored rollouts. Scaffold: `vf-init <name> [-T] [-H]`.
- The `Trace` JSON line schema was not read in this task; infer from `verifiers/v1/episode.py` and `traces.jsonl` when T-704/T-802 start.

**Decision for hone**: T-704 `hone export --rollouts` emits JSONL rows `{ id, prompt: ChatMessage[], completion: ChatMessage[], reward: number, metrics: Record<string, number>, info: { caseId, targetId, trial, scores } }`. This is the v1 TaskData + reward shape in spirit; a generated `taskset.py` stub (`vf.TaskData` with `prompt`, `@vf.reward` reading `info.reward`) ships in `examples/`. T-802 imports `traces.jsonl` once the line schema is confirmed against `verifiers/v1/episode.py`.

## 3. OpenTelemetry GenAI semantic conventions

Source: https://github.com/open-telemetry/semantic-conventions-genai, commit `6fd0d763a092db245a54104fc1124031eb3c51d2` (main, read 2026-10-12), `docs/gen-ai/{gen-ai-spans,gen-ai-agent-spans,gen-ai-events}.md`. Status: every GenAI attribute is marked Development; no release tag, schema URL still TODO.

| hone span kind | `gen_ai.operation.name` | span name | kind | key attributes |
|---|---|---|---|---|
| llm | `chat` (or `generate_content`, `text_completion`) | `{operation} {gen_ai.request.model}` | CLIENT | `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.finish_reasons`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `gen_ai.conversation.id` |
| tool | `execute_tool` | `execute_tool {gen_ai.tool.name}` | INTERNAL | `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.type`, `gen_ai.tool.description`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` |
| retrieval | `retrieval` | `retrieval {gen_ai.data_source.id}` | CLIENT | `gen_ai.data_source.id`, `gen_ai.retrieval.query.text`, `gen_ai.retrieval.top_k`, `gen_ai.retrieval.documents` |
| agent | `invoke_agent` | `invoke_agent {gen_ai.agent.name}` | INTERNAL (CLIENT for remote agents) | `gen_ai.agent.name`, `gen_ai.agent.id`, `gen_ai.agent.version`, `gen_ai.conversation.id`, `gen_ai.main_agent` |
| custom | custom value | custom | INTERNAL | `gen_ai.operation.name` only |

Also: `create_agent`, `invoke_workflow` (`gen_ai.workflow.name`), `plan`, memory operations; `error.type` (stable) on failures. Scores map to the event `gen_ai.evaluation.result` with `gen_ai.evaluation.name`, `gen_ai.evaluation.score.value`, `gen_ai.evaluation.score.label` (`pass`/`fail`), `gen_ai.evaluation.explanation`, parented to the evaluated span or carrying `gen_ai.response.id`.

**Decision for hone**: T-803 keeps every attribute string in one file `src/io/export/otel.ts` and records the commit hash above in that file. hone `Score` becomes one `gen_ai.evaluation.result` event per scorer on the trace's root `invoke_agent` span. Importing OTel JSON (T-802) reverses the table and tolerates unknown operation names as `custom`.

## 4. Docent (Transluce)

Sources: https://github.com/TransluceAI/docent `LICENSE` (read 2026-10-12): Apache-2.0, "Copyright 2025 Clarity AI Research Inc., dba Transluce". Data model from https://docs.transluce.org/concepts/overview (read 2026-10-11): Collection > AgentRun > Transcript > ChatMessage (OpenAI-compatible system/user/assistant with tool_calls/tool), optional TranscriptGroups for multi-agent, free-form `metadata` with conventional keys `scores`, `model`, `checkpoint`, `task_id`, cost and latency.

**Decision for hone**: license permits self-hosting and format reuse. T-802 imports an exported AgentRun as one hone trace: `transcripts[0].messages` to `messages`, `metadata.scores` to `Score[]` with `scorer` = key, `metadata.model` to `trace.meta.model`. T-803 exports the inverse with `metadata.task_id = caseId`, `metadata.model = targetId`.

## 5. Jev request limits

Sources: https://docs.typesafe.ai/api and https://docs.typesafe.ai/introduction/quickstart (read 2026-10-11): no documented limit on questions per request or state size; choice max 255 options, score 2 to 10 levels. Probe 2026-10-12 against `api.typesafe.ai` with the configured `TYPESAFE_API_KEY`: 100 noul questions on a one-word state returned 100 answers (usage 2050 in / 1794 out); 400 questions returned 400 answers (7750 in / 7494 out). No cap hit; output tokens scale with question count but are free.

**Decision for hone**: `JevClient` keeps no artificial question cap. Scorers batch up to 256 questions per request by default (`maxQuestionsPerRequest`, configurable) and split beyond that, so a per-step fan-out over a long trajectory stays inside what was observed to work.

## 6. Inspect eval log schema

Sources: https://inspect.aisi.org.uk/eval-logs.html (read 2026-10-12) and `uvx --from inspect-ai inspect log schema` run 2026-10-12, saved as `test/fixtures/inspect.schema.json` (OpenAPI components; 338 KB).

- `EvalLog`: `version` (2), `status` (`started`|`success`|`cancelled`|`error`), `eval`, `plan`, `results`, `stats`, `error`, `tags`, `metadata`, `log_updates`, `samples[]`, `reductions[]`.
- `EvalSample`: `id`, `epoch`, `input`, `target`, `messages`, `output`, `scores` (map of scorer name to `{ value, explanation, metadata, history }`), `events`, `metadata`.
- `.eval` is binary; `inspect log dump <uri>` prints JSON. JSON may contain `NaN`/`Inf`, so parse with a tolerant parser.

**Decision for hone**: T-802 imports JSON produced by `inspect log dump` (never the binary `.eval`), one hone trace per sample per epoch: `messages` map 1:1 (Inspect chat messages are OpenAI-shaped), `scores` map to `Score[]` with `value` normalised (`C`/`I` to 1/0, numeric kept, `P` to 0.5), `epoch` to `trial`, `id` to `caseId`, `eval.model` to `targetId`. The fixture schema is the contract test for the importer.
