import { afterEach, describe, expect, test } from "bun:test";
import valid from "../../test/fixtures/trace.valid.json";
import type { Trace } from "../core/types";
import { JevClient } from "../providers/jev";
import type { TargetOutput } from "../targets/target";
import { createScorer } from "./index";
import type { ScoreContext } from "./scorer";

const base = valid as Trace;
const ctx = (runTarget: (input: unknown) => Promise<TargetOutput>, output: unknown = "2026-07-01"): ScoreContext => ({
  case: { id: "c", input: "When does the policy start?" },
  trace: { ...base, output },
  trial: 0,
  runTarget,
});

const stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
});

describe("consistency scorer", () => {
  test("a stable target passes; inputs sent are mutated and distinct", async () => {
    const inputs: unknown[] = [];
    const s = await createScorer({ name: "consistency", n: 3 }).score(
      ctx(async (input) => {
        inputs.push(input);
        return { output: "  2026-07-01 " };
      }),
    );
    expect(s.pass).toBe(true);
    expect(s.value).toBe(1);
    // a single-clause question has nothing to reorder, so that mutation is skipped, not sent unchanged
    expect(inputs).toHaveLength(2);
    expect(new Set(inputs.map(String)).size).toBe(2);
    expect(inputs.every((i) => i !== "When does the policy start?")).toBe(true);
    const ev = s.evidence as { mutation: string; skipped?: boolean }[];
    expect(ev.map((e) => e.mutation)).toEqual(["paraphrase", "reorder", "noise"]);
    expect(ev[1]?.skipped).toBe(true);
  });

  test("an unstable target fails with per-mutation evidence", async () => {
    let n = 0;
    const applicable = ["paraphrase", "noise"];
    const s = await createScorer({ name: "consistency", n: 2, mutations: applicable }).score(ctx(async () => ({ output: n++ === 0 ? "2026-07-01" : "never" })));
    expect(s.value).toBe(0.5);
    expect(s.pass).toBe(true);
    const unstable = await createScorer({ name: "consistency", n: 2, mutations: applicable }).score(ctx(async () => ({ output: "different" })));
    expect(unstable.pass).toBe(false);
    expect((unstable.evidence as { agree: boolean }[]).every((e) => e.agree === false)).toBe(true);
  });

  test("without runTarget the score is undecided", async () => {
    const c = ctx(async () => ({ output: "x" }));
    delete c.runTarget;
    const s = await createScorer({ name: "consistency" }).score(c);
    expect(s.pass).toBeNull();
    expect(s.reason).toMatch(/runTarget/);
  });

  test("compare=jev asks whether the answers convey the same information", async () => {
    const seen: unknown[] = [];
    const srv = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      fetch: async (req) => {
        const body = (await req.json()) as { state: { a: unknown; b: unknown }; questions: Record<string, unknown> };
        seen.push(body);
        const same = String(body.state.b).includes("July 1");
        return Response.json({ answers: { same: { type: "noul", noul: same ? 0.95 : 0.05 } }, usage: { input_tokens: 5, output_tokens: 0 } });
      },
    });
    stops.push(() => srv.stop(true));
    const client = new JevClient({ provider: { apiKey: "k", endpoint: `http://127.0.0.1:${srv.port}/v1/systemone`, model: "m" } });
    const s = await createScorer({ name: "consistency", n: 2, mutations: ["paraphrase", "noise"], compare: "jev", client }).score(ctx(async () => ({ output: "It begins on July 1, 2026." })));
    expect(seen).toHaveLength(2);
    expect(s.pass).toBe(true);
    expect(s.costUsd).toBeGreaterThan(0);
  });

  test("a failing target run counts as disagreement", async () => {
    const s = await createScorer({ name: "consistency", n: 1 }).score(ctx(async () => ({ output: null, error: "boom" })));
    expect(s.value).toBe(0);
    expect((s.evidence as { error?: string }[])[0]?.error).toBe("boom");
  });
});
