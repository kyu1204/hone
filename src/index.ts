import pkg from "../package.json";

/** Package version, read from package.json at build time. */
export const VERSION: string = pkg.version;

// Public library surface: what hone.config.ts imports.
export { defineConfig } from "./core/config";
export type { GateSpec, HoneConfig, ScorerSpec, TargetSpec } from "./core/config";
export type { Case, ChatMessage, Score, Span, Trace, Trial, Verdict } from "./core/types";
export type { FnContext } from "./targets/fn";
export type { RunContext, Target, TargetOutput } from "./targets/target";
