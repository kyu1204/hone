import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  JEV_ENDPOINT,
  JEV_MODEL,
  JEV_OPENROUTER_ENDPOINT,
  JEV_OPENROUTER_MODEL,
  JevAuthError,
  JevClient,
  JevConfigError,
  JevRequestError,
  choice,
  costOfJevUsage,
  noul,
  resolveJevProvider,
  score,
} from "./jev";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-jev-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Env lookup goes through an explicit env object plus `home`/`cwd` so no real config is read. */
function resolve(env: Record<string, string>, opts: { home?: string; cwd?: string } = {}) {
  const home = opts.home ?? tmp();
  const cwd = opts.cwd ?? tmp();
  return resolveJevProvider(env, { home, cwd });
}

describe("resolveJevProvider", () => {
  test("TYPESAFE_API_KEY wins over OPENROUTER_API_KEY", () => {
    expect(resolve({ TYPESAFE_API_KEY: "ts", OPENROUTER_API_KEY: "or" })).toEqual({ apiKey: "ts", endpoint: JEV_ENDPOINT, model: JEV_MODEL });
  });
  test("OPENROUTER_API_KEY alone routes to the OpenRouter mirror", () => {
    expect(resolve({ OPENROUTER_API_KEY: "or" })).toEqual({ apiKey: "or", endpoint: JEV_OPENROUTER_ENDPOINT, model: JEV_OPENROUTER_MODEL });
  });
  test("HONE_JEV_ENDPOINT must be https unless loopback; HONE_JEV_MODEL overrides the model", () => {
    expect(resolve({ TYPESAFE_API_KEY: "ts", HONE_JEV_ENDPOINT: "http://127.0.0.1:9/x", HONE_JEV_MODEL: "m" })).toEqual({ apiKey: "ts", endpoint: "http://127.0.0.1:9/x", model: "m" });
    expect(() => resolve({ TYPESAFE_API_KEY: "ts", HONE_JEV_ENDPOINT: "http://example.com" })).toThrow(/https/);
    expect(resolve({ HONE_JEV_ENDPOINT: "http://localhost:11434/v1/systemone" }).apiKey).toBe("");
  });
  test("env files are read in order: cwd/.env, then ~/.config/hone/env, then ~/.config/jgrep/env", () => {
    const home = tmp();
    const cwd = tmp();
    fs.mkdirSync(path.join(home, ".config", "jgrep"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "jgrep", "env"), "TYPESAFE_API_KEY=from-jgrep\n");
    expect(resolve({}, { home, cwd }).apiKey).toBe("from-jgrep");
    fs.mkdirSync(path.join(home, ".config", "hone"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "hone", "env"), "TYPESAFE_API_KEY=from-hone\n");
    expect(resolve({}, { home, cwd }).apiKey).toBe("from-hone");
    fs.writeFileSync(path.join(cwd, ".env"), 'TYPESAFE_API_KEY="from-dotenv"\n');
    expect(resolve({}, { home, cwd }).apiKey).toBe("from-dotenv");
  });
  test("no key anywhere throws JevConfigError naming both variables", () => {
    expect(() => resolve({})).toThrow(JevConfigError);
    expect(() => resolve({})).toThrow(/TYPESAFE_API_KEY.*OPENROUTER_API_KEY/);
  });
});

describe("question builders", () => {
  test("noul, choice and score build request objects and validate limits", () => {
    expect(noul("Is it true?")).toEqual({ type: "noul", instructions: "Is it true?" });
    expect(noul("Is it true?", { true: "yes", false: "no" })).toEqual({ type: "noul", instructions: "Is it true?", criteria: { true: "yes", false: "no" } });
    expect(choice("Pick", { a: "A", b: null })).toEqual({ type: "choice", instructions: "Pick", criteria: { a: "A", b: null } });
    expect(score("Rate", ["bad", "ok", "good"])).toEqual({ type: "score", instructions: "Rate", criteria: ["bad", "ok", "good"] });
    const many = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`o${i}`, null]));
    expect(() => choice("Pick", many)).toThrow(/255/);
    expect(() => choice("Pick", {})).toThrow(/at least 1/);
    expect(() => score("Rate", ["only"])).toThrow(/2/);
    expect(() => score("Rate", Array.from({ length: 11 }, (_, i) => `l${i}`))).toThrow(/10/);
  });
  test("cost follows the published input price", () => {
    expect(costOfJevUsage({ input_tokens: 1_000_000, output_tokens: 5 })).toBeCloseTo(0.042, 6);
    expect(costOfJevUsage(undefined)).toBe(0);
  });
});

type Handler = (req: Request) => Response | Promise<Response>;
function serve(handler: Handler): { url: string; stop: () => void } {
  const server = Bun.serve({ port: 0, fetch: handler });
  return { url: `http://127.0.0.1:${server.port}/v1/systemone`, stop: () => server.stop(true) };
}

const answer = { answers: { q: { type: "noul", noul: 0.9 } }, model: "jev-1.13.0", usage: { input_tokens: 10, output_tokens: 0 } };

describe("JevClient", () => {
  test("sends auth header, model and questions; returns answers, usage and cost", async () => {
    let seen: { auth: string | null; body: Record<string, unknown> } | undefined;
    const s = serve(async (req) => {
      seen = { auth: req.headers.get("authorization"), body: (await req.json()) as Record<string, unknown> };
      return Response.json(answer);
    });
    try {
      const c = new JevClient({ provider: { apiKey: "k", endpoint: s.url, model: "jev-latest" } });
      const res = await c.ask({ text: "state" }, { q: noul("Is it?") });
      expect(seen?.auth).toBe("Bearer k");
      expect(seen?.body.model).toBe("jev-latest");
      expect(seen?.body.state).toEqual({ text: "state" });
      expect(res.answers.q).toEqual({ type: "noul", noul: 0.9 });
      expect(res.usage.input_tokens).toBe(10);
      expect(res.costUsd).toBeCloseTo(10 * 0.042e-6, 12);
    } finally {
      s.stop();
    }
  });

  test("retries on 429 with Retry-After then succeeds", async () => {
    let calls = 0;
    const s = serve(() => {
      calls++;
      return calls === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } }) : Response.json(answer);
    });
    try {
      const c = new JevClient({ provider: { apiKey: "k", endpoint: s.url, model: "m" }, maxRetries: 2, baseDelayMs: 1 });
      const res = await c.ask("s", { q: noul("x") });
      expect(calls).toBe(2);
      expect(res.answers.q).toEqual({ type: "noul", noul: 0.9 });
    } finally {
      s.stop();
    }
  });

  test("401 throws JevAuthError without retrying; 400 throws JevRequestError with the body", async () => {
    let calls = 0;
    const s = serve(() => {
      calls++;
      return new Response('{"error":"invalid_api_key"}', { status: 401 });
    });
    try {
      const c = new JevClient({ provider: { apiKey: "bad", endpoint: s.url, model: "m" }, maxRetries: 3, baseDelayMs: 1 });
      await expect(c.ask("s", { q: noul("x") })).rejects.toBeInstanceOf(JevAuthError);
      expect(calls).toBe(1);
    } finally {
      s.stop();
    }
    const s2 = serve(() => new Response("bad question shape", { status: 400 }));
    try {
      const c = new JevClient({ provider: { apiKey: "k", endpoint: s2.url, model: "m" } });
      await expect(c.ask("s", { q: noul("x") })).rejects.toThrow(JevRequestError);
      await expect(c.ask("s", { q: noul("x") })).rejects.toThrow(/bad question shape/);
    } finally {
      s2.stop();
    }
  });

  test("times out a hanging request and reports it", async () => {
    const s = serve(() => new Promise(() => {}));
    try {
      const c = new JevClient({ provider: { apiKey: "k", endpoint: s.url, model: "m" }, requestTimeoutMs: 30, maxRetries: 0 });
      await expect(c.ask("s", { q: noul("x") })).rejects.toThrow(/timed out/);
    } finally {
      s.stop();
    }
  });

  test("concurrency limit is honoured", async () => {
    let inFlight = 0;
    let peak = 0;
    const s = serve(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(15);
      inFlight--;
      return Response.json(answer);
    });
    try {
      const c = new JevClient({ provider: { apiKey: "k", endpoint: s.url, model: "m" }, concurrency: 2 });
      await Promise.all(Array.from({ length: 6 }, () => c.ask("s", { q: noul("x") })));
      expect(peak).toBe(2);
    } finally {
      s.stop();
    }
  });
});
