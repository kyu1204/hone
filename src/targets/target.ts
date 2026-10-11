import { Store } from "../core/store";
import { type Artifacts, assertTrace, type ChatMessage, type Span, type Trace, type Usage } from "../core/types";
import type { TargetSpec } from "../core/config";

export interface RunContext {
  runId: string;
  caseId: string;
  trial: number;
  workspace?: string;
  signal?: AbortSignal;
  /** Set by fork (T-701): messages to pin before re-running. */
  prefix?: ChatMessage[];
}

export interface TargetOutput {
  output: unknown;
  messages?: ChatMessage[];
  spans?: Span[];
  artifacts?: Artifacts;
  usage?: Partial<Usage>;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface Target {
  readonly id: string;
  readonly kind: string;
  /** Content hash of what the target is; part of every cache key. */
  version(): Promise<string>;
  run(input: unknown, ctx: RunContext): Promise<TargetOutput>;
  resume?(prefix: ChatMessage[], input: unknown, ctx: RunContext): Promise<TargetOutput>;
  close?(): Promise<void>;
}

export function toTrace(out: TargetOutput, ctx: RunContext, targetId: string, startedAt: Date, endedAt: Date): Trace {
  const trace: Trace = {
    id: Store.trialId(ctx.runId, ctx.caseId, targetId, ctx.trial),
    caseId: ctx.caseId,
    targetId,
    trial: ctx.trial,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    messages: out.messages ?? [],
    spans: out.spans ?? [],
    output: out.output,
    usage: { inputTokens: out.usage?.inputTokens ?? 0, outputTokens: out.usage?.outputTokens ?? 0, costUsd: out.usage?.costUsd ?? 0 },
  };
  if (out.artifacts) trace.artifacts = out.artifacts;
  if (out.error !== undefined) trace.error = out.error;
  if (out.meta) trace.meta = out.meta;
  assertTrace(trace);
  return trace;
}

// ---------------------------------------------------------------------------
// Registry. Adapter modules call registerTargetKind at import time.

export type TargetFactory = (id: string, spec: TargetSpec) => Target;
const factories = new Map<string, TargetFactory>();

export function registerTargetKind(kind: string, factory: TargetFactory): void {
  factories.set(kind, factory);
}

export function knownTargetKinds(): string[] {
  return [...factories.keys()].sort();
}

export function createTarget(id: string, spec: TargetSpec): Target {
  const factory = factories.get(spec.kind);
  if (!factory) throw new Error(`unknown target kind "${spec.kind}" for target "${id}"; known kinds: ${knownTargetKinds().join(", ")}`);
  return factory(id, spec);
}

export function createTargets(specs: Record<string, TargetSpec>): Record<string, Target> {
  return Object.fromEntries(Object.entries(specs).map(([id, spec]) => [id, createTarget(id, spec)]));
}
