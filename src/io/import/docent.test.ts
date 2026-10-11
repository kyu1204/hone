import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { agentRunsOf, importDocent } from "./docent";

const fixture = new URL("../../../test/fixtures/import/docent.json", import.meta.url).pathname;

describe("docent import", () => {
  test("accepts an AgentRun, an array, or { agent_runs }", () => {
    const run = { id: "x", transcripts: [{ messages: [] }] };
    expect(agentRunsOf(run)).toHaveLength(1);
    expect(agentRunsOf([run, run])).toHaveLength(2);
    expect(agentRunsOf({ agent_runs: [run] })).toHaveLength(1);
    expect(() => agentRunsOf({ nope: 1 })).toThrow(/Docent/);
  });
  test("maps transcripts, metadata scores, model and task id; transcript groups too", () => {
    const { cases, trials } = importDocent(JSON.parse(fs.readFileSync(fixture, "utf8")), { runId: "r" });
    expect(cases.map((c) => c.id)).toEqual(["bug-1", "run-b"]);
    expect(cases[0]!.input).toBe("Fix the bug");
    const [a, b] = trials;
    expect(a!.trace.targetId).toBe("claude-opus-5-5");
    expect(a!.trace.messages[1]!.tool_calls![0]!.function).toEqual({ name: "Bash", arguments: '{"cmd":"bun test"}' });
    expect(a!.scores).toEqual([{ scorer: "correct", value: 1, pass: null }, { scorer: "no_hack", value: 1, pass: true }]);
    expect(a!.pass).toBe(true);
    expect(a!.costUsd).toBe(0.2);
    expect(a!.trace.output).toBe("Done.");
    expect(b!.trace.targetId).toBe("claude-sonnet-5-5");
    expect(b!.trace.messages).toHaveLength(2);
    expect(b!.pass).toBeNull();
  });
});
