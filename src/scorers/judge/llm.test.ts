import { afterEach, describe, expect, test } from "bun:test";
import valid from "../../../test/fixtures/trace.valid.json";
import type { Trace } from "../../core/types";
import type { LlmProvider } from "../../providers/llm";
import { createScorer } from "../index";
import type { ScoreContext } from "../scorer";

const base = valid as Trace;
const ctx = (extra: Partial<ScoreContext> = {}): ScoreContext => ({ case: { id: "c", input: "When does it start?", expected: "2026-07-01", rubric: "Answer gives the start date and cites a chunk" }, trace: base, trial: 0, ...extra });

type Req = { messages: { role: string; content: string }[]; response_format?: unknown };
function stub(reply: (req: Req, n: number) => string): { provider: LlmProvider; reqs: Req[]; stop: () => void } {
  const reqs: Req[] = [];
  const s = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = (await req.json()) as Req;
      reqs.push(body);
      return Response.json({ choices: [{ message: { content: reply(body, reqs.length) } }], usage: { prompt_tokens: 50, completion_tokens: 20 }, model: "gpt-5-mini" });
    },
  });
  return { provider: { kind: "openai", apiKey: "k", baseUrl: `http://127.0.0.1:${s.port}/v1`, model: "gpt-5-mini" }, reqs, stop: () => s.stop(true) };
}
const stops: (() => void)[] = [];
afterEach(() => {
  for (const f of stops.splice(0)) f();
});

describe("llm.rubric", () => {
  test("single dimension: JSON verdict maps to value, pass and reason; prompt carries the rubric and an Unknown option", async () => {
    const j = stub(() => JSON.stringify({ dimensions: { overall: { score: 4, reason: "cites c1 and gives the date" } }, overall: 4, reason: "good", verdict: "pass" }));
    stops.push(j.stop);
    const s = await createScorer({ name: "llm.rubric", provider: j.provider }).score(ctx());
    expect(s.value).toBe(0.8);
    expect(s.pass).toBe(true);
    expect(s.reason).toBe("good");
    expect(s.costUsd).toBeGreaterThan(0);
    const prompt = j.reqs[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("Answer gives the start date and cites a chunk");
    expect(prompt).toMatch(/unknown/i);
    expect(j.reqs[0]!.response_format).toEqual({ type: "json_object" });
  });

  test("dimensions are listed in the prompt and returned as evidence; unknown verdict gives pass null", async () => {
    const j = stub(() => JSON.stringify({ dimensions: { accuracy: { score: 5, reason: "a" }, grounding: { score: 2, reason: "b" } }, overall: 3, reason: "mixed", verdict: "unknown" }));
    stops.push(j.stop);
    const s = await createScorer({ name: "llm.rubric", dimensions: ["accuracy", "grounding"], provider: j.provider }).score(ctx());
    expect(s.pass).toBeNull();
    expect(s.value).toBe(0.6);
    expect((s.evidence as { dimension: string; score: number }[]).map((e) => `${e.dimension}:${e.score}`)).toEqual(["accuracy:5", "grounding:2"]);
    expect(j.reqs[0]!.messages.at(-1)!.content).toContain("grounding");
  });

  test("bad JSON triggers one repair attempt, then an undecided score", async () => {
    const j = stub((_r, n) => (n === 1 ? "not json at all" : JSON.stringify({ overall: 2, reason: "repaired", verdict: "fail" })));
    stops.push(j.stop);
    const s = await createScorer({ name: "llm.rubric", provider: j.provider }).score(ctx());
    expect(j.reqs).toHaveLength(2);
    expect(s.pass).toBe(false);
    expect(s.reason).toBe("repaired");
    const k = stub(() => "still not json");
    stops.push(k.stop);
    const u = await createScorer({ name: "llm.rubric", provider: k.provider }).score(ctx());
    expect(k.reqs).toHaveLength(2);
    expect(u.pass).toBeNull();
    expect(u.reason).toMatch(/JSON/);
  });

  test("code fences around JSON are tolerated", async () => {
    const j = stub(() => '```json\n{"overall":5,"reason":"x","verdict":"pass"}\n```');
    stops.push(j.stop);
    expect((await createScorer({ name: "llm.rubric", provider: j.provider }).score(ctx())).pass).toBe(true);
  });
});

describe("llm.pairwise", () => {
  test("swap: agreeing orders give a win, disagreeing orders give a tie", async () => {
    const j = stub((r) => {
      const text = r.messages.at(-1)!.content;
      // candidate A is whichever appears first; the judge prefers the hone output ("It starts on") whenever it sees it as A
      return JSON.stringify({ winner: text.indexOf("It starts on") < text.indexOf("Maybe June") ? "A" : "B", reason: "dated and cited" });
    });
    stops.push(j.stop);
    const s = await createScorer({ name: "llm.pairwise", provider: j.provider }).score(ctx({ runOther: async () => ({ output: "Maybe June." }) }));
    expect(j.reqs).toHaveLength(2);
    expect(s.value).toBe(1);
    expect(s.pass).toBe(true);
    const flip = stub(() => JSON.stringify({ winner: "A", reason: "whatever is first" }));
    stops.push(flip.stop);
    const t = await createScorer({ name: "llm.pairwise", provider: flip.provider }).score(ctx({ runOther: async () => ({ output: "Maybe June." }) }));
    expect(t.value).toBe(0.5);
    expect(t.pass).toBeNull();
    expect(t.reason).toMatch(/order/);
  });

  test("without runOther the score is undecided", async () => {
    const s = await createScorer({ name: "llm.pairwise", provider: { kind: "openai", apiKey: "k", baseUrl: "http://127.0.0.1:9/v1", model: "m" } }).score(ctx());
    expect(s.pass).toBeNull();
    expect(s.reason).toMatch(/runOther/);
  });
});
