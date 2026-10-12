// Inline scorer: a function in hone.config.ts that gets the score context and returns a Score, a number or a boolean.
import type { Score } from "../core/types";
import { registerScorerKind, type ScoreContext, type Scorer } from "./scorer";

export type FnScoreResult = Partial<Score> | number | boolean;
export interface FnScorerSpec {
  name: "fn";
  id?: string;
  score: (ctx: ScoreContext) => Promise<FnScoreResult> | FnScoreResult;
  /** pass when a bare number is at least this (default 0.5) */
  threshold?: number;
  /** Set to make results cacheable (the function body is not part of the key); omit to always re-run. */
  cacheKey?: string;
}

export function fnScorer(spec: FnScorerSpec): Scorer {
  if (typeof spec.score !== "function") throw new Error('fn scorer needs a `score` function: { name: "fn", score: (ctx) => ... }');
  const threshold = spec.threshold ?? 0.5;
  return {
    name: String(spec.id ?? "fn"),
    async score(ctx) {
      const r = await spec.score(ctx);
      if (typeof r === "number") return { scorer: "", value: r, pass: r >= threshold };
      if (typeof r === "boolean") return { scorer: "", value: r ? 1 : 0, pass: r };
      return { scorer: "", value: r.value ?? (r.pass === true ? 1 : r.pass === false ? 0 : 0), pass: r.pass ?? (r.value === undefined ? null : r.value >= threshold), ...(r.reason ? { reason: r.reason } : {}), ...(r.evidence ? { evidence: r.evidence } : {}), ...(r.costUsd ? { costUsd: r.costUsd } : {}) };
    },
    cacheKeyExtra: () => (spec.cacheKey === undefined ? Symbol.for("no-cache") : { cacheKey: spec.cacheKey }),
  };
}

registerScorerKind("fn", (spec) => fnScorer(spec as unknown as FnScorerSpec));
