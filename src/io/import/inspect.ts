// Inspect AI eval logs (JSON from `inspect log dump`), per docs/compat.md section 6.
import type { Case, Score } from "../../core/types";
import { type Imported, makeTrial, nowIso, toChatMessage } from "./common";

/** JSON.parse that tolerates bare NaN/Infinity tokens outside strings (Inspect writes them). */
export function parseInspectJson(text: string): unknown {
  const cleaned = text.replace(/(?<=[:,[]\s*)(-?Infinity|NaN)(?=\s*[,}\]])/g, "null");
  return JSON.parse(cleaned);
}

interface InspectScore {
  value?: unknown;
  explanation?: unknown;
  answer?: unknown;
}
interface InspectSample {
  id?: unknown;
  epoch?: unknown;
  input?: unknown;
  target?: unknown;
  messages?: unknown[];
  output?: { choices?: { message?: Record<string, unknown> }[]; usage?: { input_tokens?: number; output_tokens?: number; total_cost?: number }; model?: string };
  scores?: Record<string, InspectScore>;
  started_at?: string;
  completed_at?: string;
  error?: unknown;
  metadata?: Record<string, unknown>;
}
interface InspectLog {
  version?: unknown;
  status?: unknown;
  eval?: { task?: string; task_id?: string; run_id?: string; model?: string };
  samples?: InspectSample[];
}

export function inspectScore(name: string, s: InspectScore): Score {
  const v = s.value;
  const reason = typeof s.explanation === "string" ? s.explanation : undefined;
  if (v === "C") return { scorer: name, value: 1, pass: true, reason };
  if (v === "I") return { scorer: name, value: 0, pass: false, reason };
  if (v === "P") return { scorer: name, value: 0.5, pass: null, reason };
  if (typeof v === "number" && Number.isFinite(v)) return { scorer: name, value: Math.max(0, Math.min(1, v)), pass: null, reason };
  if (typeof v === "boolean") return { scorer: name, value: v ? 1 : 0, pass: v, reason };
  return { scorer: name, value: 0, pass: null, reason: reason ?? `unrecognised value ${JSON.stringify(v)}` };
}

export function importInspect(log: unknown, opts: { runId?: string; target?: string } = {}): Imported {
  const l = log as InspectLog;
  if (!l || !Array.isArray(l.samples)) throw new Error("not an Inspect eval log: samples[] missing (use `inspect log dump`, not the binary .eval)");
  const runId = opts.runId ?? "imported";
  const targetId = opts.target ?? l.eval?.model ?? "inspect";
  const cases = new Map<string, Case>();
  const trials = l.samples.map((s) => {
    const caseId = String(s.id ?? cases.size);
    const messages = (s.messages ?? []).map((m) => toChatMessage(m as Record<string, unknown>));
    const choice = s.output?.choices?.[0]?.message;
    const output = choice ? toChatMessage(choice).content : (messages.filter((m) => m.role === "assistant").at(-1)?.content ?? null);
    const scores = Object.entries(s.scores ?? {}).map(([name, sc]) => inspectScore(name, sc ?? {}));
    const usage = s.output?.usage ?? {};
    if (!cases.has(caseId)) cases.set(caseId, { id: caseId, input: s.input, ...(s.target !== undefined ? { expected: s.target } : {}), tags: ["inspect", ...(l.eval?.task ? [l.eval.task] : [])] });
    const startedAt = s.started_at ?? nowIso();
    return makeTrial(runId, {
      caseId,
      targetId,
      trial: Math.max(0, (typeof s.epoch === "number" ? s.epoch : 1) - 1),
      startedAt,
      endedAt: s.completed_at ?? startedAt,
      messages,
      spans: [],
      output,
      usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, costUsd: usage.total_cost ?? 0 },
      ...(s.error ? { error: typeof s.error === "string" ? s.error : JSON.stringify(s.error) } : {}),
      meta: { inspect: { task: l.eval?.task, task_id: l.eval?.task_id, run_id: l.eval?.run_id }, model: s.output?.model ?? l.eval?.model },
    }, scores);
  });
  return { cases: [...cases.values()], trials };
}
