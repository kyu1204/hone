// Barrel: importing this module registers every built-in target kind.
import "./fn";
import "./http";
import "./process";
import "./python";

export { createTarget, createTargets, knownTargetKinds, registerTargetKind, toTrace } from "./target";
export type { RunContext, Target, TargetOutput } from "./target";
