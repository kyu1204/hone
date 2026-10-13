import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { importClaudeSessions, parseSession } from "./claudeCode";

const fixture = new URL("../../../test/fixtures/claude-code-session.jsonl", import.meta.url).pathname;
const empty = new URL("../../../test/fixtures/claude-code-session-empty.jsonl", import.meta.url).pathname;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("parseSession", () => {
  test("case from the first human prompt, trace with every turn, tools, usage and cost", () => {
    const s = parseSession(fs.readFileSync(fixture, "utf8"))!;
    expect(s.case.id).toBe("abcdef12");
    expect(s.case.input).toBe("Fix the flaky test in auth");
    expect(s.case.tags).toEqual(["claude-code", "feat/x"]);
    expect(s.case.meta).toMatchObject({ sessionId: "abcdef12-3456-7890-abcd-ef1234567890", cwd: "/Users/me/proj", startedAt: "2026-10-12T01:01:00.000Z" });
    const t = s.trial;
    expect(t.pass).toBeNull();
    expect(t.trace.targetId).toBe("claude-code");
    expect(t.trace.caseId).toBe("abcdef12");
    const roles = t.trace.messages.map((m) => m.role);
    expect(roles[0]).toBe("user");
    expect(roles.filter((r) => r === "user")).toHaveLength(2);
    expect(t.trace.messages.at(-1)).toEqual({ role: "assistant", content: "Added." });
    expect(t.trace.messages.flatMap((m) => m.tool_calls?.map((c) => c.function.name) ?? [])).toEqual(["Read", "Edit", "Write", "Bash", "Bash"]);
    expect(t.trace.spans).toHaveLength(5);
    expect(t.trace.spans[3]!.attrs?.error).toBe(true);
    expect(t.trace.meta).toMatchObject({ sessionId: "abcdef12-3456-7890-abcd-ef1234567890", cwd: "/Users/me/proj", gitBranch: "feat/x", claudeVersion: "2.1.300", model: "claude-opus-5-5", turns: 2 });
    // input tokens include the 500 cache-read tokens each of the seven assistant messages reports
    expect(t.trace.usage).toEqual({ inputTokens: 1200 + 1000 * 4 + 900 + 700 + 7 * 500, outputTokens: 80 + 50 * 4 + 40 + 10, costUsd: 0.42 });
    expect(t.costUsd).toBe(0.42);
    expect(t.trace.startedAt).toBe("2026-10-12T01:01:00.000Z");
    expect(t.trace.endedAt).toBe("2026-10-12T01:14:00.000Z");
    expect(t.trace.output).toBe("Added.");
  });

  test("artifacts: diff from Edit inputs, files from Write inputs", () => {
    const s = parseSession(fs.readFileSync(fixture, "utf8"))!;
    expect(s.trial.trace.artifacts?.diff).toBe("--- src/auth.ts\n- retry(1)\n+ retry(3)\n");
    expect(s.trial.trace.artifacts?.files).toEqual({ "src/auth.test.ts": "test('auth retries', () => expect(auth()).toBe(3))" });
  });

  test("a session without a human prompt is undefined; the meta prompt is not a human prompt", () => {
    expect(parseSession(fs.readFileSync(empty, "utf8"))).toBeUndefined();
    expect(parseSession("")).toBeUndefined();
  });
});

describe("importClaudeSessions", () => {
  test("scans a directory newest first with limit and since, counts skipped sessions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-ccimport-"));
    dirs.push(dir);
    const text = fs.readFileSync(fixture, "utf8");
    fs.writeFileSync(path.join(dir, "old.jsonl"), text.replaceAll("abcdef12-3456", "00000000-0000"));
    fs.utimesSync(path.join(dir, "old.jsonl"), new Date("2026-09-01"), new Date("2026-09-01"));
    fs.writeFileSync(path.join(dir, "new.jsonl"), text);
    fs.writeFileSync(path.join(dir, "empty.jsonl"), fs.readFileSync(empty, "utf8"));
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
    const all = importClaudeSessions({ dir });
    expect(all.trials.map((t) => t.trace.caseId)).toEqual(["abcdef12", "00000000"]);
    expect(all.skipped).toBe(1);
    expect(importClaudeSessions({ dir, limit: 1 }).cases).toHaveLength(1);
    expect(importClaudeSessions({ dir, since: new Date("2026-10-01") }).cases.map((c) => c.id)).toEqual(["abcdef12"]);
    expect(importClaudeSessions({ files: [path.join(dir, "old.jsonl")] }).cases[0]!.id).toBe("00000000");
  });
});
