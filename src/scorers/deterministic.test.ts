import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../test/fixtures/trace.valid.json";
import type { Case, Trace } from "../core/types";
import { createScorer } from "./index";
import type { ScoreContext } from "./scorer";

const base = valid as Trace;
const rag: Case = { id: "citations-basic", input: "When does the new policy start?", expected: "It starts on 2026-07-01 [c1]." };
const ctx = (trace: Trace, c: Case = rag): ScoreContext => ({ case: c, trace, trial: trace.trial });

const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hone-score-ws-"));
fs.writeFileSync(path.join(ws, "greeting.txt"), "hello\n");
afterAll(() => fs.rmSync(ws, { recursive: true, force: true }));

const agentTrace: Trace = {
  ...base,
  id: "agent-0",
  caseId: "fix-bug",
  targetId: "cc",
  output: "Fixed. See greeting.txt",
  startedAt: "2026-10-12T00:00:00.000Z",
  endedAt: "2026-10-12T00:00:02.500Z",
  usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.75 },
  messages: [
    { role: "user", content: "fix the bug" },
    { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "Read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "1", content: "file contents" },
    { role: "assistant", content: "", tool_calls: [{ id: "2", type: "function", function: { name: "Write", arguments: "{}" } }, { id: "3", type: "function", function: { name: "Bash", arguments: "{\"cmd\":\"bun test\"}" } }] },
    { role: "tool", tool_call_id: "2", content: "ok" },
    { role: "tool", tool_call_id: "3", content: "1 pass" },
    { role: "assistant", content: "Fixed. See greeting.txt" },
  ],
  spans: [],
  artifacts: { diff: "diff --git a/greeting.txt b/greeting.txt\nnew file mode 100644\n--- /dev/null\n+++ b/greeting.txt\n@@ -0,0 +1 @@\n+hello\n", stdout: "done", files: { "notes.md": "# todo" } },
  meta: { workspace: ws },
};

describe("exact / contains / regex", () => {
  test("exact compares output with case.expected, with normalisation and explicit expected", async () => {
    expect((await createScorer({ name: "exact" }).score(ctx(base))).pass).toBe(true);
    expect((await createScorer({ name: "exact", normalize: "trim-lower" }).score(ctx({ ...base, output: "  IT STARTS ON 2026-07-01 [C1]. " }))).pass).toBe(true);
    expect((await createScorer({ name: "exact", expected: "nope" }).score(ctx(base))).pass).toBe(false);
    const json = await createScorer({ name: "exact", normalize: "json", expected: { a: 1, b: [1, 2] } }).score(ctx({ ...base, output: '{"b":[1,2],"a":1}' }));
    expect(json.pass).toBe(true);
  });

  test("contains with all/any and ignoreCase", async () => {
    expect((await createScorer({ name: "contains", text: ["2026-07-01", "[c1]"] }).score(ctx(base))).pass).toBe(true);
    expect((await createScorer({ name: "contains", text: ["2026-07-01", "missing"] }).score(ctx(base))).value).toBe(0.5);
    expect((await createScorer({ name: "contains", text: ["missing", "starts"], all: false }).score(ctx(base))).pass).toBe(true);
    expect((await createScorer({ name: "contains", text: "IT STARTS", ignoreCase: true }).score(ctx(base))).pass).toBe(true);
  });

  test("regex over output, files, trace and stdout with match modes", async () => {
    expect((await createScorer({ name: "regex", pattern: "\\d{4}-\\d{2}-\\d{2}" }).score(ctx(base))).pass).toBe(true);
    expect((await createScorer({ name: "regex", pattern: "hello", target: "files" }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "regex", pattern: "todo", target: "files" }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "regex", pattern: "bun test", target: "trace" }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "regex", pattern: "done", target: "stdout" }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "regex", pattern: "secret", match: "not_contains" }).score(ctx(base))).pass).toBe(true);
    expect((await createScorer({ name: "regex", pattern: "c1", match: "count:1" }).score(ctx(base))).pass).toBe(true);
    expect((await createScorer({ name: "regex", pattern: "c1", match: "count:2" }).score(ctx(base))).pass).toBe(false);
    expect((await createScorer({ name: "regex", pattern: "IT STARTS", flags: "i" }).score(ctx(base))).pass).toBe(true);
  });
});

describe("json-schema", () => {
  const schema = { type: "object", required: ["answer", "n"], properties: { answer: { type: "string", minLength: 2 }, n: { type: "integer", minimum: 0, maximum: 10 }, tags: { type: "array", items: { type: "string", enum: ["a", "b"] } } }, additionalProperties: false };
  test("validates parsed strings and objects, reports the first failing path", async () => {
    const s = createScorer({ name: "json-schema", schema });
    expect((await s.score(ctx({ ...base, output: '{"answer":"ok","n":3,"tags":["a"]}' }))).pass).toBe(true);
    const bad = await s.score(ctx({ ...base, output: { answer: "ok", n: 11 } }));
    expect(bad.pass).toBe(false);
    expect(bad.reason).toMatch(/n/);
    expect((await s.score(ctx({ ...base, output: { answer: "ok", n: 1, extra: true } }))).reason).toMatch(/extra/);
    expect((await s.score(ctx({ ...base, output: { answer: "ok", n: 1, tags: ["zzz"] } }))).reason).toMatch(/tags\[0\]/);
    expect((await s.score(ctx({ ...base, output: "not json" }))).pass).toBe(false);
  });
});

describe("tool_used / tool_order / step_count", () => {
  test("tool_used all, any and not", async () => {
    expect((await createScorer({ name: "tool_used", tool: ["Read", "Write"] }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "tool_used", tool: ["Read", "Delete"] }).score(ctx(agentTrace))).value).toBe(0.5);
    expect((await createScorer({ name: "tool_used", tool: ["Delete", "Bash"], all: false }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "tool_used", tool: "Delete", not: true }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "tool_used", tool: "Bash", not: true }).score(ctx(agentTrace))).pass).toBe(false);
    expect((await createScorer({ name: "tool_used", tool: "search" }).score(ctx(base))).pass).toBe(true);
  });

  test("tool_order subsequence vs strict", async () => {
    expect((await createScorer({ name: "tool_order", tools: ["Read", "Bash"] }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "tool_order", tools: ["Bash", "Read"] }).score(ctx(agentTrace))).pass).toBe(false);
    expect((await createScorer({ name: "tool_order", tools: ["Read", "Write", "Bash"], strict: true }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "tool_order", tools: ["Read", "Bash"], strict: true }).score(ctx(agentTrace))).pass).toBe(false);
  });

  test("step_count bounds", async () => {
    const r = await createScorer({ name: "step_count", max: 3 }).score(ctx(agentTrace));
    expect(r.pass).toBe(true);
    expect(r.evidence?.[0]).toMatchObject({ steps: 3 });
    expect((await createScorer({ name: "step_count", max: 2 }).score(ctx(agentTrace))).pass).toBe(false);
    expect((await createScorer({ name: "step_count", min: 4 }).score(ctx(agentTrace))).pass).toBe(false);
  });
});

describe("cost / latency / file_exists / test_command", () => {
  test("cost and latency thresholds", async () => {
    expect((await createScorer({ name: "cost", maxUsd: 1 }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "cost", maxUsd: 0.5 }).score(ctx(agentTrace))).pass).toBe(false);
    expect((await createScorer({ name: "latency", maxMs: 3000 }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "latency", maxMs: 1000 }).score(ctx(agentTrace))).pass).toBe(false);
  });

  test("file_exists checks artifacts.files, diff headers and the workspace", async () => {
    expect((await createScorer({ name: "file_exists", path: "notes.md" }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "file_exists", path: "greeting.txt" }).score(ctx(agentTrace))).pass).toBe(true);
    expect((await createScorer({ name: "file_exists", path: ["greeting.txt", "missing.txt"] }).score(ctx(agentTrace))).value).toBe(0.5);
    expect((await createScorer({ name: "file_exists", path: "greeting.txt" }).score(ctx({ ...agentTrace, artifacts: {}, meta: {} }))).pass).toBe(false);
    expect((await createScorer({ name: "file_exists", path: "greeting.txt", workspace: ws }).score(ctx({ ...agentTrace, artifacts: {}, meta: {} }))).pass).toBe(true);
  });

  test("test_command runs in the workspace and reports exit code and tail", async () => {
    const ok = await createScorer({ name: "test_command", command: ["bun", "-e", "console.log('fine'); process.exit(0)"] }).score(ctx(agentTrace));
    expect(ok.pass).toBe(true);
    expect(ok.evidence?.[0]).toMatchObject({ exitCode: 0 });
    const bad = await createScorer({ name: "test_command", command: ["bun", "-e", "console.error('boom'); process.exit(2)"] }).score(ctx(agentTrace));
    expect(bad.pass).toBe(false);
    expect(JSON.stringify(bad.evidence)).toContain("boom");
    const noWs = await createScorer({ name: "test_command", command: ["true"] }).score(ctx({ ...agentTrace, meta: {} }));
    expect(noWs.pass).toBeNull();
    expect(noWs.reason).toMatch(/workspace/);
  });
});
