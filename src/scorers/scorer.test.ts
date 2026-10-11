import { describe, expect, test } from "bun:test";
import valid from "../../test/fixtures/trace.valid.json";
import type { Trace } from "../core/types";
import { createScorer, createScorers, knownScorerKinds, normalizeScore, registerScorerKind, type Scorer } from "./scorer";

describe("scorer registry", () => {
  test("unknown kind throws with the known list; specs build scorers in order", () => {
    expect(() => createScorer({ name: "nope" })).toThrow(/unknown scorer "nope"/);
    const s: Scorer = { name: "fake", score: () => ({ scorer: "fake", value: 1, pass: true }) };
    registerScorerKind("fake", (spec) => ({ ...s, name: String(spec.id ?? "fake") }));
    expect(knownScorerKinds()).toContain("fake");
    const scorers = createScorers([{ name: "fake", id: "a" }, { name: "fake", id: "b" }]);
    expect(scorers.map((x) => x.name)).toEqual(["a", "b"]);
  });

  test("normalizeScore clamps value, fills scorer name and coerces pass", () => {
    const trace = valid as Trace;
    expect(normalizeScore({ scorer: "", value: 1.7, pass: true }, "x", trace).value).toBe(1);
    expect(normalizeScore({ scorer: "", value: -2, pass: false }, "x", trace).value).toBe(0);
    expect(normalizeScore({ scorer: "", value: Number.NaN, pass: null }, "x", trace)).toMatchObject({ scorer: "x", value: 0, pass: null });
  });
});
