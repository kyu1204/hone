// Barrel: importing this module registers every built-in scorer kind.
import "./consistency";
import "./deterministic";
import "./fn";
import "./hack";
import "./judge/jev";
import "./judge/llm";
import "./rag";

export { cachedScorer, scorerCacheKey } from "./cached";
export { createScorer, createScorers, knownScorerKinds, normalizeScore, registerScorerKind, runScorer } from "./scorer";
export type { ScoreContext, Scorer } from "./scorer";
