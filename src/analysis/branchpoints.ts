// Rank the steps of a failed trace by how likely a fork there changes the outcome.
import type { ChatMessage, Trial } from "../core/types";
import { alignTraces } from "./diffTrace";

export interface BranchPoint {
  step: number;
  score: number;
  reasons: string[];
}

const DONE = /\b(done|complete|completed|fixed|finished|implemented|resolved|verified)\b/i;
const text = (m: ChatMessage): string => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));

/** Map tool spans with attrs.error onto tool messages: the k-th error span named X hits the k-th tool message named X. */
function errorSteps(trial: Trial): number[] {
  const out: number[] = [];
  const seen = new Map<string, number>();
  for (const span of trial.trace.spans) {
    if (span.kind !== "tool" || !span.attrs?.error) continue;
    const k = seen.get(span.name) ?? 0;
    seen.set(span.name, k + 1);
    const matches = trial.trace.messages.map((m, i) => (m.role === "tool" && m.name === span.name ? i : -1)).filter((i) => i >= 0);
    if (matches[k] !== undefined) out.push(matches[k]);
  }
  return out;
}

export function rankBranchPoints(failed: Trial, sibling?: Trial): BranchPoint[] {
  const ms = failed.trace.messages;
  const points = new Map<number, BranchPoint>();
  const add = (step: number, score: number, reason: string): void => {
    if (step < 0 || step >= ms.length) return;
    const p = points.get(step) ?? { step, score: 0, reasons: [] };
    p.score += score;
    p.reasons.push(reason);
    points.set(step, p);
  };
  for (const step of errorSteps(failed)) add(step, 3, "tool error at this step");
  if (sibling) {
    const { pairs, divergence } = alignTraces(ms, sibling.trace.messages);
    if (divergence !== null) {
      const at = pairs.slice(divergence).find(([i]) => i !== null)?.[0] ?? ms.length - 1;
      add(at, 3, "diverges from passing sibling here");
    }
    for (const [i, j] of pairs) {
      if (i === null || j === null) continue;
      const mine = ms[i]!;
      const theirs = sibling.trace.messages[j]!;
      if (mine.role === "tool" && theirs.role === "tool" && text(mine) !== text(theirs)) add(i, 2, "tool result differs from the passing sibling");
    }
  }
  const lastAssistant = ms.map((m) => m.role).lastIndexOf("assistant");
  for (let i = lastAssistant - 1; i >= 0; i--) {
    if (ms[i]!.role === "assistant" && ms[i]!.tool_calls?.length) {
      add(i, 1, "last tool call before the final answer");
      break;
    }
  }
  ms.forEach((m, i) => {
    if (m.role === "assistant" && !m.tool_calls?.length && DONE.test(text(m)) && !ms.slice(i + 1).some((n) => n.tool_calls?.length)) add(i, 1, "claims completion with no tool call after it");
  });
  for (const p of points.values()) if (p.step < ms.length * 0.2) {
    p.score -= 1;
    p.reasons.push("early in the trace (prompt edits are a different workflow)");
  }
  return [...points.values()].sort((a, b) => b.score - a.score || b.step - a.step);
}

export function topSteps(ranked: BranchPoint[], n = 3): number[] {
  return ranked.filter((r) => r.score > 0).slice(0, n).map((r) => r.step);
}

/** A passing trial of the same case (any target), or undefined. */
export function pickSibling(trial: Trial, trials: Trial[]): Trial | undefined {
  if (trial.pass !== false) return undefined;
  return trials.find((t) => t.id !== trial.id && t.pass === true && t.trace.caseId === trial.trace.caseId);
}
