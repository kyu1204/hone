import { afterEach, describe, expect, test } from "bun:test";
import valid from "../../test/fixtures/trace.valid.json";
import type { Case, Trace } from "../core/types";
import { JevClient, type JevQuestion } from "../providers/jev";
import { createScorer } from "./index";
import type { ScoreContext } from "./scorer";

const base = valid as Trace;
const trace: Trace = {
  ...base,
  output: "The policy starts on 2026-07-01 [c1]. It applies to all residents [c3]. Fees are waived [c9].",
  spans: [
    { id: "r1", kind: "retrieval", name: "search", startedAt: "2026-10-12T00:00:00Z", output: [{ id: "c1", text: "The policy starts on 2026-07-01." }, { id: "c2", text: "Unrelated chunk." }, { id: "c3", text: "It applies to all residents." }] },
  ],
};
const c: Case = { id: "q1", input: "When does the policy start and who does it apply to?", expected: { chunks: ["c1", "c3", "c7"] } };
const ctx = (t: Trace = trace): ScoreContext => ({ case: c, trace: t, trial: 0 });

type Seen = { state: unknown; questions: Record<string, JevQuestion> }[];
function jevStub(answer: (q: JevQuestion, id: string) => unknown): { client: JevClient; seen: Seen; stop: () => void } {
  const seen: Seen = [];
  const s = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch: async (req) => {
      const body = (await req.json()) as { state: unknown; questions: Record<string, JevQuestion> };
      seen.push(body);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, answer(q, id)]));
      return Response.json({ answers, usage: { input_tokens: 10, output_tokens: 0 } });
    },
  });
  return { client: new JevClient({ provider: { apiKey: "k", endpoint: `http://127.0.0.1:${s.port}/v1/systemone`, model: "m" } }), seen, stop: () => s.stop(true) };
}
const stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
});

describe("retrieval scorers", () => {
  test("context_recall and context_precision over retrieved ids", async () => {
    const recall = await createScorer({ name: "rag.context_recall" }).score(ctx());
    expect(recall.value).toBeCloseTo(2 / 3, 6);
    expect(recall.pass).toBe(false);
    expect(recall.evidence?.[0]).toMatchObject({ missing: ["c7"] });
    const precision = await createScorer({ name: "rag.context_precision" }).score(ctx());
    expect(precision.value).toBeCloseTo(2 / 3, 6);
    const none = await createScorer({ name: "rag.context_recall" }).score(ctx({ ...trace, spans: [] }));
    expect(none.pass).toBe(false);
    expect(none.reason).toMatch(/no retrieval span/);
  });

  test("citations resolve against retrieved ids", async () => {
    const s = await createScorer({ name: "rag.citations" }).score(ctx());
    expect(s.value).toBeCloseTo(2 / 3, 6);
    expect(s.pass).toBe(false);
    expect(s.evidence?.[0]).toMatchObject({ unresolved: ["c9"] });
    const ok = await createScorer({ name: "rag.citations" }).score(ctx({ ...trace, output: "Starts 2026-07-01 [c1] [c3]." }));
    expect(ok.pass).toBe(true);
    const noCite = await createScorer({ name: "rag.citations" }).score(ctx({ ...trace, output: "Starts 2026-07-01." }));
    expect(noCite.pass).toBe(false);
    expect(noCite.reason).toMatch(/no citations/);
  });
});

describe("faithfulness and relevance with a Jev stub", () => {
  test("faithfulness asks one noul per claim and aggregates", async () => {
    const stub = jevStub((q) => ({ type: "noul", noul: String(q.instructions).includes("waived") || JSON.stringify(q).includes("waived") ? 0.1 : 0.95 }));
    stops.push(stub.stop);
    const s = await createScorer({ name: "rag.faithfulness", client: stub.client }).score(ctx());
    expect(stub.seen).toHaveLength(1);
    expect(Object.keys(stub.seen[0]!.questions)).toHaveLength(3);
    expect(JSON.stringify(stub.seen[0]!.state)).toContain("The policy starts on 2026-07-01.");
    expect(s.value).toBeCloseTo((0.95 + 0.95 + 0.1) / 3, 6);
    expect(s.pass).toBe(false);
    expect((s.evidence as { claim: string; p: number }[]).find((e) => e.claim.includes("waived"))?.p).toBe(0.1);
    expect(s.costUsd).toBeGreaterThan(0);
  });

  test("faithfulness batches claims beyond the request size", async () => {
    const stub = jevStub(() => ({ type: "noul", noul: 1 }));
    stops.push(stub.stop);
    const many = Array.from({ length: 300 }, (_, i) => `Claim number ${i} is stated here clearly.`).join(" ");
    const s = await createScorer({ name: "rag.faithfulness", client: stub.client, maxClaims: 300, batchSize: 256 }).score(ctx({ ...trace, output: many }));
    expect(stub.seen).toHaveLength(2);
    expect(s.pass).toBe(true);
  });

  test("answer_relevance maps a score question to 0..1", async () => {
    const stub = jevStub(() => ({ type: "score", score: 2, legend: ["irrelevant", "partially relevant", "relevant", "directly answers"], probabilities: [0, 0, 1, 0], confidence: 0.9 }));
    stops.push(stub.stop);
    const s = await createScorer({ name: "rag.answer_relevance", client: stub.client }).score(ctx());
    expect(s.value).toBeCloseTo(2 / 3, 6);
    expect(s.reason).toMatch(/relevant/);
    const q = Object.values(stub.seen[0]!.questions)[0]!;
    expect(q.type).toBe("score");
    expect(JSON.stringify(stub.seen[0]!.state)).toContain(c.input as string);
  });
});
