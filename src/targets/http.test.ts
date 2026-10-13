import { describe, expect, test } from "bun:test";
import { createTarget } from "./index";
import type { RunContext } from "./target";

const ctx: RunContext = { runId: "r", caseId: "c1", trial: 0 };

type Handler = (req: Request) => Response | Promise<Response>;
function serve(handler: Handler): { url: string; stop: () => void } {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
  return { url: `http://127.0.0.1:${server.port}/ask`, stop: () => server.stop(true) };
}

describe("http target", () => {
  test("POST with body template and dotted output path", async () => {
    let seen: unknown;
    const s = serve(async (req) => {
      seen = await req.json();
      return Response.json({ data: { answer: "42", extra: 1 } });
    });
    try {
      const t = createTarget("rag", { kind: "http", url: s.url, body: (c: { input: unknown; caseId: string }) => ({ q: c.input, case: c.caseId }), output: "data.answer" });
      const out = await t.run("why?", ctx);
      expect(seen).toEqual({ q: "why?", case: "c1" });
      expect(out.output).toBe("42");
      expect(out.error).toBeUndefined();
    } finally {
      s.stop();
    }
  });

  test("default body is { input }, default output is the whole JSON, text bodies stay text", async () => {
    let seen: unknown;
    const s = serve(async (req) => {
      seen = await req.json();
      return new Response("plain text", { headers: { "content-type": "text/plain" } });
    });
    try {
      const t = createTarget("t", { kind: "http", url: s.url });
      const out = await t.run({ a: 1 }, ctx);
      expect(seen).toEqual({ input: { a: 1 } });
      expect(out.output).toBe("plain text");
    } finally {
      s.stop();
    }
  });

  test("lifts a _hone trace field and an x-hone-trace header", async () => {
    const trace = { messages: [{ role: "user", content: "q" }, { role: "assistant", content: "a" }], spans: [{ id: "s1", kind: "retrieval", name: "search", startedAt: "2026-10-12T00:00:00Z" }], usage: { inputTokens: 3, outputTokens: 1 } };
    const s = serve(() => Response.json({ answer: "a", _hone: trace }));
    try {
      const out = await createTarget("t", { kind: "http", url: s.url, output: "answer" }).run("q", ctx);
      expect(out.messages).toHaveLength(2);
      expect(out.spans?.[0]?.name).toBe("search");
      expect(out.usage).toEqual({ inputTokens: 3, outputTokens: 1 });
    } finally {
      s.stop();
    }
    const s2 = serve(() => new Response(JSON.stringify({ answer: "b" }), { headers: { "content-type": "application/json", "x-hone-trace": btoa(JSON.stringify({ usage: { costUsd: 0.5 } })) } }));
    try {
      const out = await createTarget("t", { kind: "http", url: s2.url, output: "answer", traceField: "nope" }).run("q", ctx);
      expect(out.output).toBe("b");
      expect(out.usage).toEqual({ costUsd: 0.5 });
    } finally {
      s2.stop();
    }
  });

  test("GET sends input as a query parameter", async () => {
    let seenUrl = "";
    const s = serve((req) => {
      seenUrl = req.url;
      return Response.json({ ok: true });
    });
    try {
      await createTarget("t", { kind: "http", url: s.url, method: "GET" }).run("hello world", ctx);
      expect(new URL(seenUrl).searchParams.get("input")).toBe('"hello world"');
    } finally {
      s.stop();
    }
  });

  test("non-2xx and timeouts become TargetOutput.error, never throws", async () => {
    const s = serve(() => new Response("upstream down", { status: 502 }));
    try {
      const out = await createTarget("t", { kind: "http", url: s.url }).run("q", ctx);
      expect(out.output).toBeNull();
      expect(out.error).toMatch(/HTTP 502: upstream down/);
    } finally {
      s.stop();
    }
    const slow = serve(() => new Promise(() => {}));
    try {
      const out = await createTarget("t", { kind: "http", url: slow.url, timeoutMs: 30 }).run("q", ctx);
      expect(out.error).toMatch(/timed out/);
    } finally {
      slow.stop();
    }
  });

  test("resume sends the prefix in the default body and prefixes the returned messages", async () => {
    let seen: Record<string, unknown> | undefined;
    const s = serve(async (req) => {
      seen = (await req.json()) as Record<string, unknown>;
      return Response.json({ answer: "continued" });
    });
    try {
      const prefix = [{ role: "user" as const, content: "earlier" }, { role: "assistant" as const, content: "reply" }];
      const t = createTarget("t", { kind: "http", url: s.url, output: "answer" });
      const out = await t.resume!(prefix, "next", ctx);
      expect(seen).toEqual({ input: "next", prefix });
      expect(out.output).toBe("continued");
      expect(out.messages).toEqual(prefix);
      const viaCtx = await t.run("next", { ...ctx, prefix });
      expect(viaCtx.messages).toEqual(prefix);
    } finally {
      s.stop();
    }
  });

  test("version is stable for the same spec and changes with it; explicit version wins", async () => {
    const a = createTarget("t", { kind: "http", url: "http://x/ask", body: (c: { input: unknown }) => ({ q: c.input }) });
    const b = createTarget("t", { kind: "http", url: "http://x/ask", body: (c: { input: unknown }) => ({ q: c.input }) });
    const c = createTarget("t", { kind: "http", url: "http://x/ask2" });
    expect(await a.version()).toBe(await b.version());
    expect(await a.version()).not.toBe(await c.version());
    expect(await createTarget("t", { kind: "http", url: "http://x", version: "svc@1.2" }).version()).toBe("svc@1.2");
    expect(await createTarget("t", { kind: "http", url: "http://x", version: async () => "dyn" }).version()).toBe("dyn");
  });
});
