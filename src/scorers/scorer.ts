import type { ScorerSpec } from "../core/config";
import type { Case, Score, Trace } from "../core/types";
import type { TargetOutput } from "../targets/target";

export interface ScoreContext {
  case: Case;
  trace: Trace;
  trial: number;
  signal?: AbortSignal;
  /** Provided by the executor: run the same target on another input (consistency scorer). */
  runTarget?(input: unknown): Promise<TargetOutput>;
  /** Provided by compare: the output to compare against (pairwise judge). */
  runOther?(): Promise<TargetOutput>;
}

export interface Scorer {
  readonly name: string;
  score(ctx: ScoreContext): Promise<Score> | Score;
  /** Extra material for the cache key (e.g. judge model). Symbol.for("no-cache") disables caching. */
  cacheKeyExtra?(): unknown;
}

export type ScorerFactory = (spec: ScorerSpec) => Scorer;
const factories = new Map<string, ScorerFactory>();

export function registerScorerKind(kind: string, factory: ScorerFactory): void {
  factories.set(kind, factory);
}

export function knownScorerKinds(): string[] {
  return [...factories.keys()].sort();
}

export function createScorer(spec: ScorerSpec): Scorer {
  const factory = factories.get(spec.name);
  if (!factory) throw new Error(`unknown scorer "${spec.name}"; known scorers: ${knownScorerKinds().join(", ")}`);
  return factory(spec);
}

export function createScorers(specs: ScorerSpec[]): Scorer[] {
  return specs.map(createScorer);
}

/** Clamp value into 0..1, fill the scorer name, coerce pass. */
export function normalizeScore(s: Score, scorerName: string, _trace: Trace): Score {
  const value = Number.isFinite(s.value) ? Math.min(1, Math.max(0, s.value)) : 0;
  const pass = s.pass === true ? true : s.pass === false ? false : null;
  return { ...s, scorer: s.scorer || scorerName, value, pass };
}

/** Run one scorer safely: exceptions become a null-pass score with the error as reason. */
export async function runScorer(scorer: Scorer, ctx: ScoreContext): Promise<Score> {
  try {
    return normalizeScore(await scorer.score(ctx), scorer.name, ctx.trace);
  } catch (e) {
    return { scorer: scorer.name, value: 0, pass: null, reason: `scorer error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
