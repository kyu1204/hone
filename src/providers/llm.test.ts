import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LlmAuthError, LlmConfigError, chat, resolveLlmProvider } from "./llm";
import { priceOf } from "./pricing";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-llm-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function resolve(env: Record<string, string>) {
  return resolveLlmProvider(env, { home: tmp(), cwd: tmp() });
}

describe("resolveLlmProvider", () => {
  test("anthropic key wins by default, openai otherwise, HONE_LLM_PROVIDER forces", () => {
    expect(resolve({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })).toMatchObject({ kind: "anthropic", apiKey: "a", model: "claude-sonnet-5-5" });
    expect(resolve({ OPENAI_API_KEY: "o" })).toMatchObject({ kind: "openai", apiKey: "o", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini" });
    expect(resolve({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", HONE_LLM_PROVIDER: "openai" }).kind).toBe("openai");
  });
  test("base url and model overrides", () => {
    expect(resolve({ OPENAI_API_KEY: "o", OPENAI_BASE_URL: "http://localhost:11434/v1", HONE_LLM_MODEL: "llama" })).toMatchObject({ baseUrl: "http://localhost:11434/v1", model: "llama" });
  });
  test("no key throws LlmConfigError", () => {
    expect(() => resolve({})).toThrow(LlmConfigError);
  });
});

describe("pricing", () => {
  test("known models have prices, unknown models cost zero", () => {
    expect(priceOf("claude-sonnet-5-5")).toBeDefined();
    expect(priceOf("gpt-5-mini")).toBeDefined();
    expect(priceOf("made-up")).toBeUndefined();
  });
});

type Handler = (req: Request) => Response | Promise<Response>;
function serve(handler: Handler): { base: string; stop: () => void } {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  return { base: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("chat", () => {
  test("openai wire format: path, auth, json mode, usage and cost", async () => {
    let seen: { url: string; auth: string | null; body: Record<string, unknown> } | undefined;
    const s = serve(async (req) => {
      seen = { url: new URL(req.url).pathname, auth: req.headers.get("authorization"), body: (await req.json()) as Record<string, unknown> };
      return Response.json({ choices: [{ message: { role: "assistant", content: '{"ok":true}' } }], usage: { prompt_tokens: 100, completion_tokens: 10 }, model: "gpt-5-mini" });
    });
    try {
      const res = await chat(
        { system: "Be brief", messages: [{ role: "user", content: "hi" }], json: true, temperature: 0 },
        { provider: { kind: "openai", apiKey: "k", baseUrl: `${s.base}/v1`, model: "gpt-5-mini" } },
      );
      expect(seen?.url).toBe("/v1/chat/completions");
      expect(seen?.auth).toBe("Bearer k");
      expect(seen?.body.response_format).toEqual({ type: "json_object" });
      expect((seen!.body.messages as unknown[])[0]).toEqual({ role: "system", content: "Be brief" });
      expect(res.text).toBe('{"ok":true}');
      expect(res.usage.inputTokens).toBe(100);
      const p = priceOf("gpt-5-mini")!;
      expect(res.usage.costUsd).toBeCloseTo((100 * p.inputPerM + 10 * p.outputPerM) / 1e6, 10);
      expect(res.unknownPricing).toBe(false);
    } finally {
      s.stop();
    }
  });

  test("anthropic wire format: path, headers, system field, usage", async () => {
    let seen: { url: string; key: string | null; version: string | null; body: Record<string, unknown> } | undefined;
    const s = serve(async (req) => {
      seen = { url: new URL(req.url).pathname, key: req.headers.get("x-api-key"), version: req.headers.get("anthropic-version"), body: (await req.json()) as Record<string, unknown> };
      return Response.json({ content: [{ type: "text", text: "hello" }], usage: { input_tokens: 7, output_tokens: 2 }, model: "claude-x" });
    });
    try {
      const res = await chat(
        { system: "sys", messages: [{ role: "user", content: "hi" }], maxTokens: 50, temperature: 0 },
        { provider: { kind: "anthropic", apiKey: "k", baseUrl: s.base, model: "claude-x" } },
      );
      expect(seen?.url).toBe("/v1/messages");
      expect(seen?.body).not.toHaveProperty("temperature"); // Claude 5 models reject it
      expect(seen?.key).toBe("k");
      expect(seen?.version).toBe("2023-06-01");
      expect(seen?.body.system).toBe("sys");
      expect(seen?.body.max_tokens).toBe(50);
      expect(seen?.body.messages).toEqual([{ role: "user", content: "hi" }]);
      expect(res.text).toBe("hello");
      expect(res.usage).toEqual({ inputTokens: 7, outputTokens: 2, costUsd: 0 });
      expect(res.unknownPricing).toBe(true);
    } finally {
      s.stop();
    }
  });

  test("anthropic rejects tool messages in this version", async () => {
    await expect(
      chat({ messages: [{ role: "tool", tool_call_id: "x", content: "r" }] }, { provider: { kind: "anthropic", apiKey: "k", baseUrl: "http://127.0.0.1:9", model: "m" } }),
    ).rejects.toThrow(/tool messages/);
  });

  test("429 is retried, 401 is not", async () => {
    let calls = 0;
    const s = serve(() => {
      calls++;
      return calls === 1 ? new Response("rate", { status: 429 }) : Response.json({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    });
    try {
      const res = await chat({ messages: [{ role: "user", content: "x" }] }, { provider: { kind: "openai", apiKey: "k", baseUrl: `${s.base}/v1`, model: "m" }, maxRetries: 2, baseDelayMs: 1 });
      expect(res.text).toBe("ok");
      expect(calls).toBe(2);
    } finally {
      s.stop();
    }
    const s2 = serve(() => new Response("nope", { status: 401 }));
    try {
      await expect(chat({ messages: [{ role: "user", content: "x" }] }, { provider: { kind: "openai", apiKey: "k", baseUrl: `${s2.base}/v1`, model: "m" }, maxRetries: 2, baseDelayMs: 1 })).rejects.toBeInstanceOf(LlmAuthError);
    } finally {
      s2.stop();
    }
  });
});
