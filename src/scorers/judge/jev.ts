// Jev judge scorers: yes/no, rubric levels, classification, and per-step trajectory checks.
import type { ScorerSpec } from "../../core/config";
import type { ChatMessage } from "../../core/types";
import { JevClient, type JevQuestion, type JevText, choice, noul, score as scoreQ } from "../../providers/jev";
import { registerScorerKind, type ScoreContext, type Scorer } from "../scorer";

type StateMode = "output" | "messages" | "trace" | ((ctx: ScoreContext) => unknown);

interface JevSpec extends ScorerSpec {
  instructions: string;
  state?: StateMode;
  client?: JevClient;
}

const truncate = (x: unknown, n = 500): string => {
  const s = typeof x === "string" ? x : JSON.stringify(x ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

export function buildState(mode: StateMode | undefined, ctx: ScoreContext): unknown {
  if (typeof mode === "function") return mode(ctx);
  switch (mode ?? "output") {
    case "messages":
      return ctx.trace.messages;
    case "trace":
      return { messages: ctx.trace.messages, spans: ctx.trace.spans.map((s) => ({ kind: s.kind, name: s.name, input: truncate(s.input), output: truncate(s.output) })) };
    default:
      return { input: ctx.case.input, expected: ctx.case.expected, output: ctx.trace.output };
  }
}

function withClient(spec: JevSpec): () => JevClient {
  let client = spec.client;
  return () => (client ??= new JevClient());
}

function jevNoul(spec: JevSpec & { criteria?: { true: JevText; false: JevText }; threshold?: number }): Scorer {
  const get = withClient(spec);
  const threshold = spec.threshold ?? 0.5;
  return {
    name: String(spec.id ?? "jev.noul"),
    cacheKeyExtra: () => ({ model: spec.client?.provider.model ?? "jev" }),
    async score(ctx) {
      const res = await get().ask(buildState(spec.state, ctx), { q: noul(spec.instructions, spec.criteria) });
      const a = res.answers.q;
      const p = a?.type === "noul" ? a.noul : 0;
      return { scorer: "", value: p, pass: p >= threshold, reason: `p=${p.toFixed(2)} (threshold ${threshold})`, costUsd: res.costUsd };
    },
  };
}

function jevScore(spec: JevSpec & { levels: string[]; passLevel?: number }): Scorer {
  const get = withClient(spec);
  return {
    name: String(spec.id ?? "jev.score"),
    cacheKeyExtra: () => ({ model: spec.client?.provider.model ?? "jev" }),
    async score(ctx) {
      const res = await get().ask(buildState(spec.state, ctx), { q: scoreQ(spec.instructions, spec.levels) });
      const a = res.answers.q;
      if (a?.type !== "score") return { scorer: "", value: 0, pass: null, reason: "no score answer", costUsd: res.costUsd };
      const value = a.score / (spec.levels.length - 1);
      const pass = spec.passLevel === undefined ? null : a.score >= spec.passLevel;
      return { scorer: "", value, pass, reason: a.legend?.[Math.round(a.score)] ?? spec.levels[Math.round(a.score)] ?? `score ${a.score}`, evidence: [{ score: a.score, probabilities: a.probabilities, confidence: a.confidence }], costUsd: res.costUsd };
    },
  };
}

function jevChoice(spec: JevSpec & { options: Record<string, JevText | null>; pass?: string[] }): Scorer {
  const get = withClient(spec);
  return {
    name: String(spec.id ?? "jev.choice"),
    cacheKeyExtra: () => ({ model: spec.client?.provider.model ?? "jev" }),
    async score(ctx) {
      const res = await get().ask(buildState(spec.state, ctx), { q: choice(spec.instructions, spec.options) });
      const a = res.answers.q;
      if (a?.type !== "choice") return { scorer: "", value: 0, pass: null, reason: "no choice answer", costUsd: res.costUsd };
      const value = a.probabilities?.[a.choice] ?? a.confidence ?? 0;
      const pass = spec.pass ? spec.pass.includes(a.choice) : null;
      return { scorer: "", value, pass, reason: a.choice, evidence: [{ choice: a.choice, probabilities: a.probabilities, confidence: a.confidence }], costUsd: res.costUsd };
    },
  };
}

/** One noul per assistant step, each judged with the conversation up to and including that step. */
function jevSteps(spec: JevSpec & { threshold?: number; aggregate?: "min" | "mean"; batchSize?: number }): Scorer {
  const get = withClient(spec);
  const threshold = spec.threshold ?? 0.5;
  const batchSize = spec.batchSize ?? 256;
  return {
    name: String(spec.id ?? "jev.steps"),
    cacheKeyExtra: () => ({ model: spec.client?.provider.model ?? "jev", aggregate: spec.aggregate ?? "min" }),
    async score(ctx) {
      const msgs: ChatMessage[] = ctx.trace.messages;
      const stepIdx = msgs.map((m, i) => (m.role === "assistant" ? i : -1)).filter((i) => i >= 0);
      if (stepIdx.length === 0) return { scorer: "", value: 0, pass: null, reason: "no assistant steps" };
      const probs: number[] = [];
      let costUsd = 0;
      for (let b = 0; b < stepIdx.length; b += batchSize) {
        const batch = stepIdx.slice(b, b + batchSize);
        const questions: Record<string, JevQuestion> = {};
        batch.forEach((mi, j) => {
          questions[`step${b + j}`] = noul(`Consider only the assistant step with index ${b + j} (message ${mi}). ${spec.instructions}`);
        });
        const state = { task: ctx.case.input, messages: msgs.slice(0, batch[batch.length - 1]! + 1), steps: batch.map((mi, j) => ({ step: b + j, message: mi })) };
        const res = await get().ask(state, questions);
        costUsd += res.costUsd;
        batch.forEach((_, j) => {
          const a = res.answers[`step${b + j}`];
          probs.push(a?.type === "noul" ? a.noul : 0);
        });
      }
      const value = spec.aggregate === "mean" ? probs.reduce((x, y) => x + y, 0) / probs.length : Math.min(...probs);
      return { scorer: "", value, pass: value >= threshold, reason: `${spec.aggregate ?? "min"} over ${probs.length} steps = ${value.toFixed(2)}`, evidence: probs.map((p, i) => ({ step: i, message: stepIdx[i], p })), costUsd };
    },
  };
}

registerScorerKind("jev.noul", (s) => jevNoul(s as never));
registerScorerKind("jev.score", (s) => jevScore(s as never));
registerScorerKind("jev.choice", (s) => jevChoice(s as never));
registerScorerKind("jev.steps", (s) => jevSteps(s as never));
