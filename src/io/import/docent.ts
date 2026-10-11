// Docent (Transluce) AgentRun exports, per docs/compat.md section 4.
import type { Case, Score } from "../../core/types";
import { type Imported, makeTrial, nowIso, toChatMessage } from "./common";

interface Transcript {
  id?: string;
  messages?: unknown[];
  metadata?: Record<string, unknown>;
}
interface AgentRun {
  id?: string;
  transcripts?: Transcript[] | Record<string, Transcript>;
  transcript_groups?: { id?: string; transcripts?: Transcript[] }[];
  metadata?: Record<string, unknown>;
}

export function agentRunsOf(json: unknown): AgentRun[] {
  if (Array.isArray(json)) return json as AgentRun[];
  if (typeof json === "object" && json !== null) {
    const o = json as { agent_runs?: unknown; transcripts?: unknown; transcript_groups?: unknown };
    if (Array.isArray(o.agent_runs)) return o.agent_runs as AgentRun[];
    if (o.transcripts !== undefined || o.transcript_groups !== undefined) return [json as AgentRun];
  }
  throw new Error("not a Docent export: expected an AgentRun, an array of them, or { agent_runs: [...] }");
}

function firstTranscript(run: AgentRun): Transcript | undefined {
  if (Array.isArray(run.transcripts)) return run.transcripts[0];
  if (run.transcripts && typeof run.transcripts === "object") return Object.values(run.transcripts)[0];
  return run.transcript_groups?.[0]?.transcripts?.[0];
}

export function docentScores(meta: Record<string, unknown> | undefined): Score[] {
  const scores = meta?.scores;
  if (!scores || typeof scores !== "object") return [];
  return Object.entries(scores as Record<string, unknown>).map(([scorer, v]) => {
    if (typeof v === "boolean") return { scorer, value: v ? 1 : 0, pass: v };
    if (typeof v === "number") return { scorer, value: Math.max(0, Math.min(1, v)), pass: null };
    return { scorer, value: 0, pass: null, reason: `unrecognised value ${JSON.stringify(v)}` };
  });
}

export function importDocent(json: unknown, opts: { runId?: string; target?: string } = {}): Imported {
  const runId = opts.runId ?? "imported";
  const cases = new Map<string, Case>();
  const trialsPerCase = new Map<string, number>();
  const trials = agentRunsOf(json).map((run, i) => {
    const t = firstTranscript(run);
    const messages = (t?.messages ?? []).map((m) => toChatMessage(m as Record<string, unknown>));
    const meta = run.metadata ?? {};
    const caseId = String(meta.task_id ?? run.id ?? `run-${i}`);
    const targetId = opts.target ?? (typeof meta.model === "string" ? meta.model : "docent");
    const trial = trialsPerCase.get(caseId) ?? 0;
    trialsPerCase.set(caseId, trial + 1);
    if (!cases.has(caseId)) cases.set(caseId, { id: caseId, input: messages.find((m) => m.role === "user")?.content ?? caseId, tags: ["docent"] });
    const now = nowIso();
    const costUsd = typeof meta.cost_usd === "number" ? meta.cost_usd : 0;
    return makeTrial(runId, { caseId, targetId, trial, startedAt: now, endedAt: now, messages, spans: [], output: messages.filter((m) => m.role === "assistant").at(-1)?.content ?? null, usage: { inputTokens: 0, outputTokens: 0, costUsd }, meta: { docent: { id: run.id, transcript: t?.id }, model: meta.model } }, docentScores(meta), { costUsd });
  });
  return { cases: [...cases.values()], trials };
}
