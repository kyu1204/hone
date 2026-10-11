// Minimal chat client for generative judges, taxonomy induction and evolve.
// Two wire formats: OpenAI-compatible chat/completions and Anthropic Messages.
import type { ChatMessage, Usage } from "../core/types";
import { type EnvSources, lookupEnv } from "./jev";
import { costOf, priceOf } from "./pricing";

export type LlmKind = "openai" | "anthropic";

export interface LlmProvider {
  kind: LlmKind;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const DEFAULT_MODELS: Record<LlmKind, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-5-mini",
};

export class LlmConfigError extends Error {
  name = "LlmConfigError";
}
export class LlmAuthError extends Error {
  name = "LlmAuthError";
}
export class LlmRequestError extends Error {
  name = "LlmRequestError";
  retryAfterSec?: string;
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
  }
}

export function resolveLlmProvider(env: Record<string, string | undefined> = process.env, src: EnvSources = {}): LlmProvider {
  const get = (n: string) => lookupEnv(n, env, src);
  const forced = get("HONE_LLM_PROVIDER") as LlmKind | undefined;
  const anthropicKey = get("ANTHROPIC_API_KEY");
  const openaiKey = get("OPENAI_API_KEY");
  const kind: LlmKind | undefined = forced ?? (anthropicKey ? "anthropic" : openaiKey ? "openai" : undefined);
  if (!kind) throw new LlmConfigError("No LLM API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (or HONE_LLM_PROVIDER with a matching key).");
  const model = get("HONE_LLM_MODEL") ?? DEFAULT_MODELS[kind];
  if (kind === "anthropic") {
    if (!anthropicKey) throw new LlmConfigError("HONE_LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
    return { kind, apiKey: anthropicKey, baseUrl: get("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com", model };
  }
  if (!openaiKey) throw new LlmConfigError("HONE_LLM_PROVIDER=openai but OPENAI_API_KEY is not set");
  return { kind, apiKey: openaiKey, baseUrl: get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1", model };
}

export interface ChatRequest {
  messages: ChatMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export interface ChatOptions {
  provider?: LlmProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

export interface ChatResult {
  text: string;
  usage: Usage;
  model: string;
  unknownPricing: boolean;
  raw: unknown;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export async function chat(req: ChatRequest, opts: ChatOptions = {}): Promise<ChatResult> {
  const provider = opts.provider ?? resolveLlmProvider();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const { url, headers, body } = buildRequest(provider, req);

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const ra = lastError instanceof LlmRequestError ? Number(lastError.retryAfterSec) : NaN;
      await Bun.sleep(Number.isFinite(ra) ? ra * 1000 : baseDelayMs * 2 ** (attempt - 1));
    }
    try {
      return await once(provider, fetchImpl, url, headers, body, timeoutMs);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err instanceof LlmAuthError || (err instanceof LlmRequestError && !RETRYABLE.has(err.status))) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new Error("llm: request failed");
}

function buildRequest(p: LlmProvider, req: ChatRequest): { url: string; headers: Record<string, string>; body: string } {
  if (p.kind === "anthropic") {
    if (req.messages.some((m) => m.role === "tool" || m.tool_calls)) throw new Error("llm: tool messages are not supported for anthropic in this version");
    const system = [req.system, ...req.messages.filter((m) => m.role === "system").map((m) => contentText(m))].filter(Boolean).join("\n\n");
    return {
      url: `${p.baseUrl.replace(/\/$/, "")}/v1/messages`,
      headers: { "content-type": "application/json", "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: p.model,
        max_tokens: req.maxTokens ?? 1024,
        ...(system ? { system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      }),
    };
  }
  const messages = [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages];
  return {
    url: `${p.baseUrl.replace(/\/$/, "")}/chat/completions`,
    headers: { "content-type": "application/json", authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      model: p.model,
      messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
    }),
  };
}

function contentText(m: ChatMessage): string {
  return typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

async function once(p: LlmProvider, fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<ChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers, body, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`llm: request timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new LlmAuthError(`llm: ${res.status} ${(await res.text()).slice(0, 300)}`);
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    const err = new LlmRequestError(`llm: HTTP ${res.status}: ${text}`, res.status, text);
    err.retryAfterSec = res.headers.get("retry-after") ?? undefined;
    throw err;
  }
  const raw = (await res.json()) as Record<string, unknown>;
  let text: string;
  let inputTokens: number;
  let outputTokens: number;
  if (p.kind === "anthropic") {
    const content = (raw.content as { type: string; text?: string }[] | undefined) ?? [];
    text = content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
    const u = (raw.usage as { input_tokens?: number; output_tokens?: number } | undefined) ?? {};
    inputTokens = u.input_tokens ?? 0;
    outputTokens = u.output_tokens ?? 0;
  } else {
    const choices = (raw.choices as { message?: { content?: string | null } }[] | undefined) ?? [];
    text = choices[0]?.message?.content ?? "";
    const u = (raw.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ?? {};
    inputTokens = u.prompt_tokens ?? 0;
    outputTokens = u.completion_tokens ?? 0;
  }
  const model = typeof raw.model === "string" ? raw.model : p.model;
  const priced = priceOf(model) ?? priceOf(p.model);
  const costUsd = priced ? costOf(priceOf(model) ? model : p.model, inputTokens, outputTokens) : 0;
  return { text, usage: { inputTokens, outputTokens, costUsd }, model, unknownPricing: !priced, raw };
}
