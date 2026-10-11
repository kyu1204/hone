import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../test/fixtures/trace.valid.json";
import { Cache } from "../core/cache";
import type { Trace } from "../core/types";
import { cachedScorer, scorerCacheKey } from "./cached";
import type { ScoreContext, Scorer } from "./scorer";

const base = valid as Trace;
const dirs: string[] = [];
function cache(): Cache {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-scache-"));
  dirs.push(d);
  return new Cache(d);
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function counting(extra?: () => unknown): { scorer: Scorer; calls: () => number } {
  let n = 0;
  const scorer: Scorer = {
    name: "judge",
    score: () => {
      n++;
      return { scorer: "judge", value: 0.8, pass: true, reason: "ok", costUsd: 0.01 };
    },
    ...(extra ? { cacheKeyExtra: extra } : {}),
  };
  return { scorer, calls: () => n };
}
const ctx = (trace: Trace = base, c = { id: "c", input: "q", rubric: "r" }): ScoreContext => ({ case: c, trace, trial: 0 });

describe("cachedScorer", () => {
  test("the same trace twice calls the inner scorer once; the hit costs nothing and is marked", async () => {
    const { scorer, calls } = counting();
    const c = cachedScorer(scorer, cache(), { name: "llm.rubric", rubric: "r" });
    const first = await c.score(ctx());
    const second = await c.score(ctx());
    expect(calls()).toBe(1);
    expect(first.costUsd).toBe(0.01);
    expect(second.costUsd).toBe(0);
    expect(second.evidence?.[0]).toEqual({ cached: true });
    expect(second.value).toBe(0.8);
  });

  test("a different rubric, case expected, output or judge model misses; timestamps and usage do not", async () => {
    const { scorer, calls } = counting(() => ({ model: "m1" }));
    const store = cache();
    const c = cachedScorer(scorer, store, { name: "llm.rubric", rubric: "r" });
    await c.score(ctx());
    await c.score(ctx({ ...base, startedAt: "2000-01-01T00:00:00Z", endedAt: "2000-01-01T00:00:01Z", usage: { inputTokens: 1, outputTokens: 1, costUsd: 9 } }));
    expect(calls()).toBe(1);
    await cachedScorer(scorer, store, { name: "llm.rubric", rubric: "other" }).score(ctx());
    expect(calls()).toBe(2);
    await c.score(ctx(base, { id: "c", input: "q", rubric: "r", expected: "x" } as never));
    expect(calls()).toBe(3);
    await c.score(ctx({ ...base, output: "different" }));
    expect(calls()).toBe(4);
    const { scorer: s2, calls: calls2 } = counting(() => ({ model: "m2" }));
    await cachedScorer(s2, store, { name: "llm.rubric", rubric: "r" }).score(ctx());
    expect(calls2()).toBe(1);
  });

  test("no-cache opt-out always calls the inner scorer", async () => {
    const { scorer, calls } = counting(() => Symbol.for("no-cache"));
    const c = cachedScorer(scorer, cache(), { name: "test_command" });
    await c.score(ctx());
    await c.score(ctx());
    expect(calls()).toBe(2);
  });

  test("scorerCacheKey is stable across span timestamp changes", () => {
    const a = scorerCacheKey({ name: "x" }, undefined, ctx());
    const shifted = { ...base, spans: base.spans.map((s) => ({ ...s, startedAt: "1999-01-01T00:00:00Z" })) };
    expect(scorerCacheKey({ name: "x" }, undefined, ctx(shifted))).toBe(a);
    expect(scorerCacheKey({ name: "x" }, { model: "z" }, ctx())).not.toBe(a);
  });
});
