// Barrel: importing this module registers every built-in scorer kind.
import "./consistency";
import "./deterministic";
import "./hack";
import "./rag";

export { createScorer, createScorers, knownScorerKinds, normalizeScore, registerScorerKind, runScorer } from "./scorer";
export type { ScoreContext, Scorer } from "./scorer";
