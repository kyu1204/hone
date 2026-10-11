import { describe, expect, test } from "bun:test";
import valid from "../../../test/fixtures/trace.valid.json";
import type { Trace, Trial } from "../../core/types";
import { importDocent } from "../import/docent";
import { toAgentRun, tracesToDocent } from "./docent";

const base = valid as Trace;
const trial: Trial = { id: "r-c-t-0", runId: "r", trace: { ...base, meta: { model: "gpt-5" } }, scores: [{ scorer: "exact", value: 1, pass: true, reason: "equal" }, { scorer: "faith", value: 0.7, pass: null }], flags: [], pass: true, costUsd: 0.01 };

describe("docent export", () => {
  test("AgentRun with the transcript and metadata; round trips through the importer", () => {
    const run = toAgentRun(trial);
    expect(run.id).toBe("r-c-t-0");
    expect(run.transcripts[0]!.messages).toEqual(base.messages);
    expect(run.metadata).toMatchObject({ task_id: base.caseId, model: "gpt-5", target_id: base.targetId, scores: { exact: true, faith: 0.7 }, pass: true, cost_usd: 0.01 });
    const doc = tracesToDocent([trial, { ...trial, id: "r-c-t-1", trace: { ...trial.trace, trial: 1 } }]);
    expect(doc.agent_runs).toHaveLength(2);
    const back = importDocent(doc, { runId: "x" });
    expect(back.trials.map((t) => t.trace.trial)).toEqual([0, 1]);
    expect(back.trials[0]!.trace.messages).toEqual(base.messages);
    expect(back.trials[0]!.scores).toEqual([{ scorer: "exact", value: 1, pass: true }, { scorer: "faith", value: 0.7, pass: null }]);
    expect(back.cases[0]!.id).toBe(base.caseId);
  });
});
