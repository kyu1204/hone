import type { TargetSpec } from "../core/config";
import { cacheKey } from "../core/cache";
import type { ChatMessage, Span, SpanKind, Usage } from "../core/types";
import { registerTargetKind, type RunContext, type Target, type TargetOutput } from "./target";

export interface SpanHandle {
  input(x: unknown): void;
  output(x: unknown): void;
  attr(key: string, value: unknown): void;
}

export interface FnContext {
  caseId: string;
  trial: number;
  prefix?: ChatMessage[];
  signal?: AbortSignal;
  span<T>(kind: SpanKind, name: string, body: (s: SpanHandle) => Promise<T> | T): Promise<T>;
  message(m: ChatMessage): void;
  usage(partial: Partial<Usage>): void;
}

export type FnTargetFn = (input: unknown, ctx: FnContext) => Promise<unknown | TargetOutput> | unknown | TargetOutput;

export interface FnTargetSpec extends TargetSpec {
  kind: "fn";
  fn: FnTargetFn;
  version?: string | (() => Promise<string>);
}

const OUTPUT_KEYS = ["messages", "spans", "usage", "artifacts", "error", "meta"];
function isTargetOutput(x: unknown): x is TargetOutput {
  return typeof x === "object" && x !== null && "output" in x && OUTPUT_KEYS.some((k) => k in x);
}

/** Collects spans, messages and usage while the user function runs. */
class Recorder {
  readonly spans: Span[] = [];
  readonly messages: ChatMessage[];
  usage: Partial<Usage> = {};
  private stack: string[] = [];
  private seq = 0;

  constructor(prefix?: ChatMessage[]) {
    this.messages = prefix ? [...prefix] : [];
  }

  context(ctx: RunContext): FnContext {
    const c: FnContext = {
      caseId: ctx.caseId,
      trial: ctx.trial,
      span: (kind, name, body) => this.span(kind, name, body),
      message: (m) => {
        this.messages.push(m);
      },
      usage: (u) => this.addUsage(u),
    };
    if (ctx.prefix) c.prefix = ctx.prefix;
    if (ctx.signal) c.signal = ctx.signal;
    return c;
  }

  private addUsage(u: Partial<Usage>): void {
    for (const k of ["inputTokens", "outputTokens", "costUsd"] as const) {
      if (u[k] !== undefined) this.usage[k] = (this.usage[k] ?? 0) + u[k];
    }
  }

  private async span<T>(kind: SpanKind, name: string, body: (s: SpanHandle) => Promise<T> | T): Promise<T> {
    const span: Span = { id: `s${++this.seq}`, kind, name, startedAt: new Date().toISOString() };
    const parent = this.stack.at(-1);
    if (parent) span.parentId = parent;
    this.spans.push(span);
    this.stack.push(span.id);
    const handle: SpanHandle = {
      input: (x) => {
        span.input = x;
      },
      output: (x) => {
        span.output = x;
      },
      attr: (k, v) => {
        (span.attrs ??= {})[k] = v;
      },
    };
    try {
      return await body(handle);
    } catch (e) {
      (span.attrs ??= {}).error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      span.endedAt = new Date().toISOString();
      this.stack.pop();
    }
  }

  finish(result: unknown): TargetOutput {
    const base: TargetOutput = { output: result, messages: this.messages, spans: this.spans, usage: this.usage };
    if (!isTargetOutput(result)) return base;
    const merged: TargetOutput = { ...base, output: result.output };
    if (result.messages) merged.messages = result.messages;
    if (result.spans) merged.spans = [...this.spans, ...result.spans];
    if (result.usage) merged.usage = result.usage;
    if (result.artifacts) merged.artifacts = result.artifacts;
    if (result.error !== undefined) merged.error = result.error;
    if (result.meta) merged.meta = result.meta;
    return merged;
  }
}

export function fnTarget(id: string, spec: FnTargetSpec): Target {
  const run = async (input: unknown, ctx: RunContext): Promise<TargetOutput> => {
    const rec = new Recorder(ctx.prefix);
    try {
      const result = await spec.fn(input, rec.context(ctx));
      return rec.finish(result);
    } catch (e) {
      return { output: null, error: e instanceof Error ? e.message : String(e), messages: rec.messages, spans: rec.spans, usage: rec.usage };
    }
  };
  return {
    id,
    kind: "fn",
    async version() {
      if (typeof spec.version === "string") return spec.version;
      if (typeof spec.version === "function") return spec.version();
      return cacheKey({ kind: "fn", fn: spec.fn.toString() });
    },
    run,
    resume: (prefix, input, ctx) => run(input, { ...ctx, prefix }),
  };
}

registerTargetKind("fn", (id, spec) => fnTarget(id, spec as FnTargetSpec));
