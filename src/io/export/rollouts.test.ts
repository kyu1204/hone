import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import type { ChatMessage, Trace, Trial } from "../../core/types";
import { splitPrompt, toRollout, writeRollouts } from "./rollouts";

const base = valid as Trace;
const trial = (over: Partial<Trial> = {}, trace: Partial<Trace> = {}): Trial => ({ id: "t1", runId: "r", trace: { ...base, ...trace }, scores: [{ scorer: "exact", value: 1, pass: true }, { scorer: "rag.citations", value: 0.5, pass: false }], flags: ["cached"], pass: true, costUsd: 0.01, ...over });

describe("splitPrompt", () => {
  test("prompt ends at the last user message before the first assistant message", () => {
    const { prompt, completion } = splitPrompt(base.messages);
    expect(prompt.map((m) => m.role)).toEqual(["system", "user"]);
    expect(completion[0]!.role).toBe("assistant");
    expect(prompt.length + completion.length).toBe(base.messages.length);
  });
  test("no assistant message means everything is prompt; a tool-heavy trace keeps tool turns in the completion", () => {
    const ms: ChatMessage[] = [{ role: "user", content: "a" }, { role: "user", content: "b" }];
    expect(splitPrompt(ms)).toEqual({ prompt: ms, completion: [] });
    const agent: ChatMessage[] = [{ role: "user", content: "fix" }, { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "Bash", arguments: "{}" } }] }, { role: "tool", tool_call_id: "1", name: "Bash", content: "ok" }, { role: "assistant", content: "done" }];
    const s = splitPrompt(agent);
    expect(s.prompt).toHaveLength(1);
    expect(s.completion).toHaveLength(3);
  });
});

describe("toRollout", () => {
  test("default reward is pass 1/0, info carries ids, scores, flags and cost", () => {
    const r = toRollout(trial());
    expect(r.reward).toBe(1);
    expect(r.prompt).toHaveLength(2);
    expect(r.info).toMatchObject({ trialId: "t1", runId: "r", caseId: base.caseId, targetId: base.targetId, trial: base.trial, pass: true, flags: ["cached"], costUsd: 0.01 });
    expect(r.info.scores).toEqual([{ scorer: "exact", value: 1, pass: true }, { scorer: "rag.citations", value: 0.5, pass: false }]);
    expect(toRollout(trial({ pass: false })).reward).toBe(0);
  });
  test("undecided trials fall back to the mean score; reward can be mean-score or one scorer", () => {
    expect(toRollout(trial({ pass: null })).reward).toBe(0.75);
    expect(toRollout(trial(), { reward: "mean-score" }).reward).toBe(0.75);
    expect(toRollout(trial(), { reward: "rag.citations" }).reward).toBe(0.5);
    expect(() => toRollout(trial(), { reward: "nope" })).toThrow(/scorer nope/);
    expect(toRollout(trial({}, { meta: { injectedFault: "negated" } })).info.injectedFault).toBe("negated");
  });
  test("openai format merges prompt and completion into messages", () => {
    const r = toRollout(trial(), { format: "openai" });
    expect(r.messages).toHaveLength(base.messages.length);
    expect(r.reward).toBe(1);
  });
});

describe("writeRollouts", () => {
  test("one JSON object per line, pass-only filter", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-rollouts-"));
    const out = path.join(dir, "r.jsonl");
    const n = writeRollouts([trial(), trial({ id: "t2", pass: false }), trial({ id: "t3", pass: null })], out, { passOnly: true });
    expect(n).toBe(1);
    const lines = fs.readFileSync(out, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).info.trialId).toBe("t1");
    expect(writeRollouts([trial(), trial({ id: "t2", pass: false })], out, {})).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
