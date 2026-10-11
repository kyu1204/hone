import type { TargetSpec } from "../core/config";
import { cacheKey } from "../core/cache";
import type { ChatMessage } from "../core/types";
import { registerTargetKind, type RunContext, type Target, type TargetOutput } from "./target";

export interface HttpBodyContext {
  input: unknown;
  caseId: string;
  prefix?: ChatMessage[];
}

export interface HttpTargetSpec extends TargetSpec {
  kind: "http";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  body?: ((c: HttpBodyContext) => unknown) | Record<string, unknown>;
  output?: ((json: unknown) => unknown) | string;
  /** Response JSON field holding { messages, spans, usage }. Default "_hone". */
  traceField?: string;
  version?: string | (() => Promise<string>);
}

type LiftedTrace = Pick<TargetOutput, "messages" | "spans" | "usage">;

function dotted(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (typeof acc === "object" && acc !== null ? (acc as Record<string, unknown>)[key] : undefined), value);
}

function lift(json: unknown, field: string, header: string | null): LiftedTrace {
  let src: unknown;
  if (typeof json === "object" && json !== null && field in (json as Record<string, unknown>)) src = (json as Record<string, unknown>)[field];
  else if (header) {
    try {
      src = JSON.parse(atob(header));
    } catch {
      src = undefined;
    }
  }
  if (typeof src !== "object" || src === null) return {};
  const t = src as LiftedTrace;
  const out: LiftedTrace = {};
  if (t.messages) out.messages = t.messages;
  if (t.spans) out.spans = t.spans;
  if (t.usage) out.usage = t.usage;
  return out;
}

export function httpTarget(id: string, spec: HttpTargetSpec): Target {
  const method = (spec.method ?? "POST").toUpperCase();
  const timeoutMs = spec.timeoutMs ?? 60_000;
  const traceField = spec.traceField ?? "_hone";

  const buildBody = (c: HttpBodyContext): unknown => {
    if (typeof spec.body === "function") return spec.body(c);
    if (spec.body) return spec.body;
    return c.prefix ? { input: c.input, prefix: c.prefix } : { input: c.input };
  };
  const pick = (json: unknown): unknown => (typeof spec.output === "function" ? spec.output(json) : typeof spec.output === "string" ? dotted(json, spec.output) : json);

  const run = async (input: unknown, ctx: RunContext, prefix?: ChatMessage[]): Promise<TargetOutput> => {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    ctx.signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const bodyCtx: HttpBodyContext = { input, caseId: ctx.caseId, ...(prefix ? { prefix } : {}) };
      let url = spec.url;
      const headers: Record<string, string> = { ...spec.headers };
      const init: RequestInit = { method, headers, signal: ctrl.signal };
      if (method === "GET" || method === "HEAD") {
        const u = new URL(spec.url);
        u.searchParams.set("input", JSON.stringify(input));
        url = u.toString();
      } else {
        headers["content-type"] ??= "application/json";
        init.body = JSON.stringify(buildBody(bodyCtx));
      }
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (e) {
        if (ctrl.signal.aborted) return { output: null, error: `http: request timed out after ${timeoutMs}ms` };
        return { output: null, error: `http: ${e instanceof Error ? e.message : String(e)}` };
      }
      const text = await res.text();
      if (!res.ok) return { output: null, error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        // not JSON: the output is the text body
      }
      const lifted = lift(json, traceField, res.headers.get("x-hone-trace"));
      const out: TargetOutput = { output: pick(json), ...lifted };
      if (prefix && !lifted.messages) out.messages = prefix;
      return out;
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  };

  return {
    id,
    kind: "http",
    async version() {
      if (typeof spec.version === "string") return spec.version;
      if (typeof spec.version === "function") return spec.version();
      const { version: _v, ...rest } = spec;
      return cacheKey({ ...rest, body: typeof rest.body === "function" ? rest.body.toString() : rest.body, output: typeof rest.output === "function" ? rest.output.toString() : rest.output });
    },
    run: (input, ctx) => run(input, ctx, ctx.prefix),
    resume: (prefix, input, ctx) => run(input, ctx, prefix),
  };
}

registerTargetKind("http", (id, spec) => httpTarget(id, spec as HttpTargetSpec));
