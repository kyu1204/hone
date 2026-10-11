// RL-ready JSONL: prompt, completion (full trajectory), reward, info.
import * as fs from "node:fs";
import type { ChatMessage, Trial } from "../../core/types";

export interface RolloutInfo {
  trialId: string;
  runId: string;
  caseId: string;
  targetId: string;
  trial: number;
  pass: boolean | null;
  scores: { scorer: string; value: number; pass: boolean | null }[];
  flags: string[];
  costUsd: number;
  injectedFault?: string;
}

export interface Rollout {
  prompt: ChatMessage[];
  completion: ChatMessage[];
  reward: number;
  info: RolloutInfo;
}

export interface OpenAiRollout {
  messages: ChatMessage[];
  reward: number;
  info: RolloutInfo;
}

export interface RolloutOptions {
  /** `pass` (default): 1/0 by verdict, mean score when undecided; `mean-score`; or one scorer's value. */
  reward?: string;
  format?: "trl" | "openai";
  passOnly?: boolean;
}

/** Prompt = everything up to the last user message before the first assistant message; completion = the rest. */
export function splitPrompt(messages: ChatMessage[]): { prompt: ChatMessage[]; completion: ChatMessage[] } {
  const firstAssistant = messages.findIndex((m) => m.role === "assistant");
  if (firstAssistant === -1) return { prompt: messages, completion: [] };
  let cut = firstAssistant;
  for (let i = firstAssistant - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      cut = i + 1;
      break;
    }
  }
  return { prompt: messages.slice(0, cut), completion: messages.slice(cut) };
}

const meanScore = (t: Trial): number => (t.scores.length ? t.scores.reduce((s, x) => s + x.value, 0) / t.scores.length : 0);

export function rewardOf(t: Trial, mode = "pass"): number {
  if (mode === "pass") return t.pass === true ? 1 : t.pass === false ? 0 : meanScore(t);
  if (mode === "mean-score") return meanScore(t);
  const s = t.scores.find((x) => x.scorer === mode);
  if (!s) throw new Error(`scorer ${mode} not in trial ${t.id} (has: ${t.scores.map((x) => x.scorer).join(", ") || "none"})`);
  return s.value;
}

export function toRollout(t: Trial, opts?: RolloutOptions & { format?: "trl" }): Rollout;
export function toRollout(t: Trial, opts: RolloutOptions & { format: "openai" }): OpenAiRollout;
export function toRollout(t: Trial, opts: RolloutOptions): Rollout | OpenAiRollout;
export function toRollout(t: Trial, opts: RolloutOptions = {}): Rollout | OpenAiRollout {
  const { prompt, completion } = splitPrompt(t.trace.messages);
  const info: RolloutInfo = { trialId: t.id, runId: t.runId, caseId: t.trace.caseId, targetId: t.trace.targetId, trial: t.trace.trial, pass: t.pass, scores: t.scores.map((s) => ({ scorer: s.scorer, value: s.value, pass: s.pass })), flags: t.flags, costUsd: t.costUsd };
  if (typeof t.trace.meta?.injectedFault === "string") info.injectedFault = t.trace.meta.injectedFault;
  const reward = rewardOf(t, opts.reward);
  if (opts.format === "openai") return { messages: [...prompt, ...completion], reward, info };
  return { prompt, completion, reward, info };
}

/** Writes one JSON object per line; returns the number written. */
export function writeRollouts(trials: Trial[], out: string, opts: RolloutOptions = {}): number {
  const kept = opts.passOnly ? trials.filter((t) => t.pass === true) : trials;
  fs.writeFileSync(out, kept.map((t) => JSON.stringify(toRollout(t, opts))).join("\n") + (kept.length ? "\n" : ""));
  return kept.length;
}
