import { type Cache, cacheKey } from "../core/cache";
import type { ScorerSpec } from "../core/config";
import type { Score } from "../core/types";
import type { ScoreContext, Scorer } from "./scorer";

/**
 * Key over everything a scorer can read, minus timing and usage: trace output, messages,
 * spans without timestamps, artifacts, error; the case id, expected and rubric; the spec;
 * and the scorer's own extra (e.g. judge model).
 */
export function scorerCacheKey(spec: ScorerSpec, extra: unknown, ctx: ScoreContext): string {
  const { trace, case: c } = ctx;
  return cacheKey({
    scorer: spec,
    extra: extra ?? null,
    case: { id: c.id, expected: c.expected ?? null, rubric: c.rubric ?? null, input: c.input },
    trace: {
      output: trace.output,
      messages: trace.messages,
      spans: trace.spans.map(({ startedAt: _s, endedAt: _e, ...rest }) => rest),
      artifacts: trace.artifacts ?? null,
      error: trace.error ?? null,
    },
  });
}

const NO_CACHE = Symbol.for("no-cache");

export function cachedScorer(scorer: Scorer, cache: Cache, spec: ScorerSpec): Scorer {
  return {
    name: scorer.name,
    ...(scorer.cacheKeyExtra ? { cacheKeyExtra: scorer.cacheKeyExtra } : {}),
    async score(ctx) {
      const extra = scorer.cacheKeyExtra?.();
      if (extra === NO_CACHE) return scorer.score(ctx);
      const key = scorerCacheKey(spec, extra, ctx);
      const hit = cache.get<Score>(key);
      if (hit) return { ...hit, costUsd: 0, evidence: [{ cached: true }, ...(hit.evidence ?? [])] };
      const fresh = await scorer.score(ctx);
      cache.set(key, fresh);
      return fresh;
    },
  };
}
