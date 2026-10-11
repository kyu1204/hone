// Barrel: importing this module registers every built-in scorer kind.
import "./deterministic";
import "./hack";

export { createScorer, createScorers, knownScorerKinds, normalizeScore, registerScorerKind, runScorer } from "./scorer";
export type { ScoreContext, Scorer } from "./scorer";
