// Barrel: importing this module registers every built-in target kind.
import "./docker";
import "./fn";
import "./http";
import "./mcp";
import "./process";
import "./python";
import "./replay";

export { createTarget, createTargets, knownTargetKinds, registerTargetKind, toTrace } from "./target";
export type { RunContext, Target, TargetOutput } from "./target";
