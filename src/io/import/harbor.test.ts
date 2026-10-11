import { describe, expect, test } from "bun:test";
import { harborRewards, importHarbor } from "./harbor";

const job = new URL("../../../test/fixtures/import/harbor", import.meta.url).pathname;

describe("harbor import", () => {
  test("a trial directory: results.json + ATIF trajectory + rewards", () => {
    const { cases, trials } = importHarbor(`${job}/trial-1`, { runId: "r" });
    expect(cases).toEqual([{ id: "hello-world", input: "Print hello world to /app/out.txt", tags: ["harbor"] }]);
    const t = trials[0]!;
    expect(t.trace).toMatchObject({ caseId: "hello-world", targetId: "claude-code", trial: 0, startedAt: "2026-10-12T02:00:00Z", endedAt: "2026-10-12T02:03:00Z", output: "Done." });
    expect(t.trace.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(t.trace.spans[0]).toMatchObject({ kind: "tool", name: "bash" });
    expect(t.scores).toEqual([{ scorer: "reward", value: 1, pass: true }]);
    expect(t.pass).toBe(true);
    expect(t.trace.usage).toEqual({ inputTokens: 5000, outputTokens: 400, costUsd: 0 });
    expect(t.trace.meta).toMatchObject({ model: "anthropic/claude-opus-5-5", harbor: { id: "trial-1" } });
  });
  test("a job directory imports every trial; reward.txt is the fallback", () => {
    const { trials } = importHarbor(job, { runId: "r", target: "cc" });
    expect(trials).toHaveLength(1);
    expect(trials[0]!.trace.targetId).toBe("cc");
    expect(harborRewards(`${job}/trial-1`, { verifier_result: { rewards: null } })).toEqual({ reward: 1 });
    expect(() => importHarbor(`${job}/nope`)).toThrow(/no Harbor trial/);
  });
});
