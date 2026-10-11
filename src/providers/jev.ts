// TypeSafe Jev System One client. Facts as of 2026-10-11 (https://docs.typesafe.ai/api):
// POST /v1/systemone with { model, state, questions }; questions are noul / choice / score.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const JEV_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/systemone";
export const JEV_OPENROUTER_MODEL = "~typesafe/jev-latest";
/** USD per input token. Output tokens are free. */
export const JEV_INPUT_USD_PER_TOKEN = 0.042 / 1_000_000;

// ---------------------------------------------------------------------------
// Env resolution shared by providers: process env, ./.env, ~/.config/hone/env, ~/.config/jgrep/env.

export interface EnvSources {
  home?: string;
  cwd?: string;
}

function parseEnvFile(file: string): Record<string, string> {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** First non-empty value for `name` across env, then the env files in precedence order. */
export function lookupEnv(name: string, env: Record<string, string | undefined> = process.env, src: EnvSources = {}): string | undefined {
  const direct = env[name];
  if (direct) return direct;
  const home = src.home ?? os.homedir();
  const cwd = src.cwd ?? process.cwd();
  for (const file of [path.join(cwd, ".env"), path.join(home, ".config", "hone", "env"), path.join(home, ".config", "jgrep", "env")]) {
    const v = parseEnvFile(file)[name];
    if (v) return v;
  }
  return undefined;
}

// ---------------------------------------------------------------------------

export interface JevProvider {
  apiKey: string;
  endpoint: string;
  model: string;
}

export class JevConfigError extends Error {
  name = "JevConfigError";
}
export class JevAuthError extends Error {
  name = "JevAuthError";
}
export class JevRequestError extends Error {
  name = "JevRequestError";
  retryAfterSec?: string;
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
  }
}

function isLoopback(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
}

export function resolveJevProvider(env: Record<string, string | undefined> = process.env, src: EnvSources = {}): JevProvider {
  const get = (n: string) => lookupEnv(n, env, src);
  const override = get("HONE_JEV_ENDPOINT");
  const model = get("HONE_JEV_MODEL");
  if (override) {
    const url = new URL(override);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url)))
      throw new JevConfigError(`HONE_JEV_ENDPOINT must be https:// (or a loopback http:// stub): ${override}`);
  }
  const typesafe = get("TYPESAFE_API_KEY");
  if (typesafe) return { apiKey: typesafe, endpoint: override ?? JEV_ENDPOINT, model: model ?? JEV_MODEL };
  const openrouter = get("OPENROUTER_API_KEY");
  if (openrouter) return { apiKey: openrouter, endpoint: override ?? JEV_OPENROUTER_ENDPOINT, model: model ?? JEV_OPENROUTER_MODEL };
  if (override && new URL(override).protocol === "http:") return { apiKey: "", endpoint: override, model: model ?? JEV_MODEL };
  throw new JevConfigError(
    "No Jev API key. Set TYPESAFE_API_KEY (api.typesafe.ai) or OPENROUTER_API_KEY (OpenRouter mirror) in the environment, ./.env or ~/.config/hone/env.",
  );
}

// ---------------------------------------------------------------------------
// Questions and answers.

export type JevText = string | Record<string, unknown> | unknown[];

export interface NoulQuestion {
  type: "noul";
  instructions: JevText;
  criteria?: { true: JevText; false: JevText };
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: JevText;
  criteria: Record<string, JevText | null>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: JevText;
  criteria: JevText[];
}
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; legend: string[]; probabilities: number[]; confidence: number };

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface JevResult {
  answers: Record<string, JevAnswer>;
  usage: JevUsage;
  model: string;
  costUsd: number;
}

export function noul(instructions: JevText, criteria?: { true: JevText; false: JevText }): NoulQuestion {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}

export function choice(instructions: JevText, options: Record<string, JevText | null>): ChoiceQuestion {
  const n = Object.keys(options).length;
  if (n < 1) throw new RangeError("choice needs at least 1 option");
  if (n > 255) throw new RangeError(`choice allows at most 255 options, got ${n}`);
  return { type: "choice", instructions, criteria: options };
}

export function score(instructions: JevText, levels: JevText[]): ScoreQuestion {
  if (levels.length < 2) throw new RangeError("score needs at least 2 levels");
  if (levels.length > 10) throw new RangeError(`score allows at most 10 levels, got ${levels.length}`);
  return { type: "score", instructions, criteria: levels };
}

export function costOfJevUsage(usage: JevUsage | undefined): number {
  return (usage?.input_tokens ?? 0) * JEV_INPUT_USD_PER_TOKEN;
}

// ---------------------------------------------------------------------------
// Client with retry, timeout, rate limit and concurrency.

export interface JevClientOptions {
  provider?: JevProvider;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  ratePerSec?: number;
  concurrency?: number;
}

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export class JevClient {
  readonly provider: JevProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly minIntervalMs: number;
  private nextSlot = 0;
  private readonly sem: Semaphore;

  constructor(opts: JevClientOptions = {}) {
    this.provider = opts.provider ?? resolveJevProvider();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 20_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.minIntervalMs = opts.ratePerSec && opts.ratePerSec > 0 ? 1000 / opts.ratePerSec : 0;
    this.sem = new Semaphore(Math.max(1, opts.concurrency ?? 4));
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs === 0) return;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    if (slot > now) await Bun.sleep(slot - now);
  }

  async ask(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResult> {
    const release = await this.sem.acquire();
    try {
      const body = JSON.stringify({ model: this.provider.model, state, questions });
      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        if (attempt > 0) await Bun.sleep(this.backoff(attempt, lastError));
        await this.throttle();
        try {
          return await this.once(body);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          if (!this.isRetryable(err)) throw err;
          lastError = err;
        }
      }
      throw lastError ?? new Error("jev: request failed");
    } finally {
      release();
    }
  }

  private isRetryable(err: Error): boolean {
    if (err instanceof JevAuthError) return false;
    if (err instanceof JevRequestError) return RETRYABLE.has(err.status);
    return true; // network errors and timeouts
  }

  private backoff(attempt: number, lastError: Error | undefined): number {
    const retryAfter = lastError instanceof JevRequestError ? Number(lastError.retryAfterSec) : NaN;
    if (Number.isFinite(retryAfter)) return retryAfter * 1000;
    const exp = this.baseDelayMs * 2 ** (attempt - 1);
    return exp + Math.random() * exp * 0.2;
  }

  private async once(body: string): Promise<JevResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.requestTimeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.provider.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.provider.apiKey ? { authorization: `Bearer ${this.provider.apiKey}` } : {}) },
        body,
        signal: ctrl.signal,
      });
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error(`jev: request timed out after ${this.requestTimeoutMs}ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new JevAuthError(`jev: ${res.status} ${await res.text()}`.slice(0, 300));
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      const err = new JevRequestError(`jev: HTTP ${res.status}: ${text}`, res.status, text);
      err.retryAfterSec = res.headers.get("retry-after") ?? undefined;
      throw err;
    }
    const json = (await res.json()) as { answers?: Record<string, JevAnswer>; usage?: JevUsage; model?: string };
    const usage = json.usage ?? { input_tokens: 0, output_tokens: 0 };
    return { answers: json.answers ?? {}, usage, model: json.model ?? this.provider.model, costUsd: costOfJevUsage(usage) };
  }
}
