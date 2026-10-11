// hone trials -> Docent AgentRun exports, per docs/compat.md section 4 (the inverse of io/import/docent.ts).
import type { ChatMessage, Trial } from "../../core/types";

export interface DocentAgentRun {
  id: string;
  transcripts: { id: string; messages: ChatMessage[]; metadata: Record<string, unknown> }[];
  metadata: Record<string, unknown>;
}

export function toAgentRun(t: Trial): DocentAgentRun {
  const scores: Record<string, number | boolean> = {};
  for (const s of t.scores) scores[s.scorer] = s.pass === null ? s.value : s.pass;
  return {
    id: t.id,
    transcripts: [{ id: `${t.id}-0`, messages: t.trace.messages, metadata: { spans: t.trace.spans.length, error: t.trace.error ?? null } }],
    metadata: {
      task_id: t.trace.caseId,
      model: t.trace.meta?.model ?? t.trace.targetId,
      target_id: t.trace.targetId,
      trial: t.trace.trial,
      run_id: t.runId,
      scores,
      score_reasons: Object.fromEntries(t.scores.filter((s) => s.reason).map((s) => [s.scorer, s.reason])),
      pass: t.pass,
      flags: t.flags,
      cost_usd: t.costUsd,
      usage: t.trace.usage,
      started_at: t.trace.startedAt,
      finished_at: t.trace.endedAt,
      output: t.trace.output,
    },
  };
}

export function tracesToDocent(trials: Trial[]): { agent_runs: DocentAgentRun[] } {
  return { agent_runs: trials.map(toAgentRun) };
}
