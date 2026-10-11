import { afterEach, describe, expect, test } from "bun:test";
import { createScorers } from "../scorers/index";
import type { Scorer } from "../scorers/scorer";
import { type RewardServer, startRewardServer } from "./reward";

const servers: RewardServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});

async function up(scorers: Scorer[]): Promise<{ url: string; log: string[] }> {
  const log: string[] = [];
  const s = await startRewardServer({ scorers, port: 0, log: (l) => log.push(l) });
  servers.push(s);
  return { url: `http://${s.host}:${s.port}`, log };
}
const post = (url: string, body: unknown): Promise<Response> => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("reward server", () => {
  test("health lists the scorers", async () => {
    const { url } = await up(createScorers([{ name: "exact" }, { name: "contains", id: "has-paris", text: "Paris" }]));
    const r = await fetch(`${url}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, scorers: ["exact", "has-paris"] });
  });

  test("score runs every scorer on the posted messages; reward follows the verdict", async () => {
    const { url, log } = await up(createScorers([{ name: "exact" }, { name: "contains", id: "has-paris", text: "Paris" }]));
    const ok = await post(`${url}/score`, { messages: [{ role: "user", content: "capital of France?" }, { role: "assistant", content: "Paris" }], case: { id: "q1", expected: "Paris" } });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { reward: number; pass: boolean | null; scores: { scorer: string; pass: boolean | null }[] };
    expect(body.reward).toBe(1);
    expect(body.pass).toBe(true);
    expect(body.scores.map((s) => s.scorer)).toEqual(["exact", "has-paris"]);
    const bad = (await (await post(`${url}/score`, { output: "Lyon", case: { expected: "Paris" } })).json()) as { reward: number; pass: boolean | null };
    expect(bad).toMatchObject({ reward: 0, pass: false });
    expect(log.some((l) => /score/.test(l))).toBe(true);
  });

  test("undecided verdicts return the mean score value", async () => {
    const undecided: Scorer = { name: "soft", score: () => ({ scorer: "", value: 0.6, pass: null }) };
    const { url } = await up([undecided]);
    const r = (await (await post(`${url}/score`, { output: "x" })).json()) as { reward: number; pass: boolean | null };
    expect(r).toEqual(expect.objectContaining({ reward: 0.6, pass: null }));
  });

  test("batch keeps order; bad bodies are 400; a throwing scorer is 500", async () => {
    const boom: Scorer = { name: "boom", score: () => { throw new Error("kaboom"); } };
    const { url } = await up(createScorers([{ name: "exact" }]));
    const batch = (await (await post(`${url}/batch`, { items: [{ output: "a", case: { expected: "a" } }, { output: "b", case: { expected: "a" } }, { output: "a", case: { expected: "a" } }] })).json()) as { results: { reward: number }[] };
    expect(batch.results.map((r) => r.reward)).toEqual([1, 0, 1]);
    expect((await post(`${url}/score`, "{not json")).status).toBe(400);
    expect((await post(`${url}/score`, { case: { expected: "a" } })).status).toBe(400);
    expect((await post(`${url}/batch`, { items: "nope" })).status).toBe(400);
    expect((await fetch(`${url}/nope`)).status).toBe(404);
    const { url: url2 } = await up([boom]);
    const r = await post(`${url2}/score`, { output: "x" });
    expect(r.status).toBe(500);
    expect(((await r.json()) as { error: string }).error).toMatch(/kaboom/);
  });
});
