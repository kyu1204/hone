import { afterEach, describe, expect, test } from "bun:test";
import valid from "../../../test/fixtures/trace.valid.json";
import type { Trace } from "../../core/types";
import { JevClient, type JevQuestion } from "../../providers/jev";
import { createScorer } from "../index";
import type { ScoreContext } from "../scorer";

const base = valid as Trace;
const ctx = (t: Trace = base): ScoreContext => ({ case: { id: "c", input: "When does it start?", expected: "2026-07-01", rubric: "cites a chunk" }, trace: t, trial: 0 });

type Body = { state: unknown; questions: Record<string, JevQuestion> };
function stub(answer: (q: JevQuestion, id: string) => unknown): { client: JevClient; bodies: Body[]; stop: () => void } {
  const bodies: Body[] = [];
  const s = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch: async (req) => {
      const body = (await req.json()) as Body;
      bodies.push(body);
      return Response.json({ answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, answer(q, id)])), usage: { input_tokens: 4, output_tokens: 0 } });
    },
  });
  return { client: new JevClient({ provider: { apiKey: "k", endpoint: `http://127.0.0.1:${s.port}/v1/systemone`, model: "jev-test" } }), bodies, stop: () => s.stop(true) };
}
const stops: (() => void)[] = [];
afterEach(() => {
  for (const f of stops.splice(0)) f();
});

describe("jev.noul", () => {
  test("default state carries input, expected and output; threshold decides pass", async () => {
    const j = stub(() => ({ type: "noul", noul: 0.62 }));
    stops.push(j.stop);
    const s = await createScorer({ name: "jev.noul", instructions: "The answer cites a chunk", client: j.client }).score(ctx());
    expect(j.bodies[0]!.state).toEqual({ input: "When does it start?", expected: "2026-07-01", output: base.output });
    expect(Object.values(j.bodies[0]!.questions)[0]).toMatchObject({ type: "noul", instructions: "The answer cites a chunk" });
    expect(s.value).toBe(0.62);
    expect(s.pass).toBe(true);
    expect(s.costUsd).toBeGreaterThan(0);
    const strict = await createScorer({ name: "jev.noul", instructions: "x", threshold: 0.7, client: j.client }).score(ctx());
    expect(strict.pass).toBe(false);
  });

  test("state builders: messages, trace and a function", async () => {
    const j = stub(() => ({ type: "noul", noul: 1 }));
    stops.push(j.stop);
    await createScorer({ name: "jev.noul", instructions: "x", state: "messages", client: j.client }).score(ctx());
    expect(j.bodies[0]!.state).toEqual(base.messages);
    await createScorer({ name: "jev.noul", instructions: "x", state: "trace", client: j.client }).score(ctx());
    expect(JSON.stringify(j.bodies[1]!.state)).toContain("search");
    await createScorer({ name: "jev.noul", instructions: "x", state: (c: ScoreContext) => ({ only: c.trace.output }), client: j.client }).score(ctx());
    expect(j.bodies[2]!.state).toEqual({ only: base.output });
  });
});

describe("jev.score and jev.choice", () => {
  test("score normalises levels and uses passLevel", async () => {
    const levels = ["bad", "ok", "good", "great"];
    const j = stub(() => ({ type: "score", score: 2, legend: levels, probabilities: [0, 0, 1, 0], confidence: 0.8 }));
    stops.push(j.stop);
    const s = await createScorer({ name: "jev.score", instructions: "Rate", levels, client: j.client }).score(ctx());
    expect(s.value).toBeCloseTo(2 / 3, 6);
    expect(s.pass).toBeNull();
    expect(s.reason).toBe("good");
    expect((await createScorer({ name: "jev.score", instructions: "Rate", levels, passLevel: 2, client: j.client }).score(ctx())).pass).toBe(true);
    expect((await createScorer({ name: "jev.score", instructions: "Rate", levels, passLevel: 3, client: j.client }).score(ctx())).pass).toBe(false);
  });

  test("choice reports the chosen option probability and pass set", async () => {
    const j = stub(() => ({ type: "choice", choice: "retrieval-failure", probabilities: { "retrieval-failure": 0.7, hallucination: 0.3 }, confidence: 0.7 }));
    stops.push(j.stop);
    const s = await createScorer({ name: "jev.choice", instructions: "Classify", options: { "retrieval-failure": null, hallucination: null }, pass: ["none"], client: j.client }).score(ctx());
    expect(s.value).toBe(0.7);
    expect(s.pass).toBe(false);
    expect(s.reason).toBe("retrieval-failure");
    expect((s.evidence![0] as { choice: string }).choice).toBe("retrieval-failure");
  });
});

describe("jev.steps", () => {
  test("one noul per assistant step with the conversation so far, aggregated by min or mean", async () => {
    const j = stub((_q, id) => ({ type: "noul", noul: id.endsWith("1") ? 0.3 : 0.9 }));
    stops.push(j.stop);
    const s = await createScorer({ name: "jev.steps", instructions: "The step verifies before claiming completion", client: j.client }).score(ctx());
    expect(j.bodies).toHaveLength(1);
    const qs = Object.keys(j.bodies[0]!.questions);
    expect(qs).toEqual(["step0", "step1"]);
    expect(JSON.stringify(j.bodies[0]!.state)).toContain("tool_calls");
    expect(s.value).toBe(0.3);
    expect(s.pass).toBe(false);
    expect((s.evidence as { step: number; p: number }[]).map((e) => e.p)).toEqual([0.9, 0.3]);
    const mean = await createScorer({ name: "jev.steps", instructions: "x", aggregate: "mean", client: j.client }).score(ctx());
    expect(mean.value).toBeCloseTo(0.6, 6);
  });

  test("batches beyond 256 steps", async () => {
    const j = stub(() => ({ type: "noul", noul: 1 }));
    stops.push(j.stop);
    const msgs = Array.from({ length: 300 }, (_, i) => ({ role: "assistant" as const, content: `step ${i}` }));
    const s = await createScorer({ name: "jev.steps", instructions: "x", client: j.client }).score(ctx({ ...base, messages: msgs }));
    expect(j.bodies).toHaveLength(2);
    expect(s.pass).toBe(true);
  });
});
