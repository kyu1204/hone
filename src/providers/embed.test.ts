import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cosine, embed, hashEmbed } from "./embed";

const empty = fs.mkdtempSync(path.join(os.tmpdir(), "hone-embed-"));
const src = { home: empty, cwd: empty };

const stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
});

describe("hashEmbed", () => {
  test("deterministic, unit-norm, and similar texts are closer than unrelated ones", () => {
    const [a, a2, b, c] = hashEmbed(["the policy starts in july", "the policy starts in july", "policy start date is july", "git diff shows test.skip inserted"]);
    expect(a).toEqual(a2);
    expect(a!.length).toBe(512);
    const norm = Math.sqrt(a!.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 9);
    expect(cosine(a!, b!)).toBeGreaterThan(cosine(a!, c!));
    expect(hashEmbed([""])[0]!.every((x) => x === 0)).toBe(true);
  });
});

describe("embed", () => {
  test("falls back to hashing without a key and uses the OpenAI endpoint with one", async () => {
    const offline = await embed(["x", "y"], { env: {}, src });
    expect(offline.method).toBe("hash");
    expect(offline.vectors).toHaveLength(2);
    let seen: unknown;
    const srv = Bun.serve({
      port: 0,
      fetch: async (req) => {
        seen = { url: new URL(req.url).pathname, body: await req.json(), auth: req.headers.get("authorization") };
        return Response.json({ data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }], usage: { prompt_tokens: 4 } });
      },
    });
    stops.push(() => srv.stop(true));
    const online = await embed(["x", "y"], { env: { OPENAI_API_KEY: "k", OPENAI_BASE_URL: `http://127.0.0.1:${srv.port}/v1` }, src });
    expect(online.method).toBe("openai");
    expect(online.vectors).toEqual([[1, 0], [0, 1]]);
    expect(seen).toMatchObject({ url: "/v1/embeddings", auth: "Bearer k", body: { input: ["x", "y"], model: "text-embedding-3-small" } });
  });
});
