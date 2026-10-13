// Coding-agent harness benchmark. Claude Code, isolated from the operator's own setup, on 15 tasks cut from this
// repository's history (see build_tasks.py). Variables: the model, how much the task statement says (title only, or
// title plus written requirements), and a rules text appended to the system prompt.
//   HONE_BENCH_STATEMENT=title (default): targets sonnet-plain, opus-plain (+ -rules when rules.md exists), cases.json
//   HONE_BENCH_STATEMENT=spec: targets sonnet-spec, opus-spec (+ -rules when rules.md exists), cases-spec.json
import * as fs from "node:fs";
import { defineConfig, type TargetSpec } from "../../src/index.ts";
import { AGENT_PATH, BASE_ARGV, containment, ranTests, resolved, TASKS, wroteTests } from "./bench.ts";

const rulesFile = `${import.meta.dir}/rules.md`;
const RULES = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, "utf8").trim() : "";
const SPEC = process.env.HONE_BENCH_STATEMENT === "spec";

function agent(model: "sonnet" | "opus", rules: boolean): TargetSpec {
  return {
    kind: "process",
    agent: "claude-code",
    workspace: `${TASKS}/{caseId}`,
    isolate: "copy",
    timeoutMs: 20 * 60_000,
    model,
    env: { PATH: AGENT_PATH },
    command: [...BASE_ARGV, "--model", model, ...(rules ? ["--append-system-prompt", RULES] : [])],
    version: `${model}-${SPEC ? "spec" : "title"}-${rules ? `rules-${Bun.hash(RULES).toString(16)}` : "plain"}`,
  };
}

export default defineConfig({
  targets: SPEC
    ? { "sonnet-spec": agent("sonnet", false), "opus-spec": agent("opus", false), ...(RULES ? { "sonnet-spec-rules": agent("sonnet", true), "opus-spec-rules": agent("opus", true) } : {}) }
    : { "sonnet-plain": agent("sonnet", false), "opus-plain": agent("opus", false), ...(RULES ? { "sonnet-plain-rules": agent("sonnet", true), "opus-plain-rules": agent("opus", true) } : {}) },
  cases: SPEC ? "cases-spec.json" : "cases.json",
  trials: 3,
  concurrency: 2,
  scorers: [
    { name: "fn", id: "resolved", score: resolved },
    { name: "fn", id: "containment", score: containment },
    { name: "fn", id: "ran-tests", score: ranTests },
    { name: "fn", id: "wrote-tests", score: wroteTests },
  ],
});
