import { describe, expect, test } from "bun:test";
import type { HoneConfig } from "./config";
import { buildPlan } from "./plan";
import type { Case } from "./types";

const cases: Case[] = [
  { id: "citations-basic", input: "a", tags: ["smoke", "rag"] },
  { id: "citations-multi", input: "b", tags: ["rag"] },
  { id: "fix-flaky-test", input: "c", tags: ["agent"] },
];
const targets = ["rag", "cc"];
const config = (extra: Partial<HoneConfig> = {}): HoneConfig => ({ targets: { rag: { kind: "fn" }, cc: { kind: "fn" } }, cases: [], scorers: [], ...extra });

describe("buildPlan", () => {
  test("cross product with defaults", () => {
    const plan = buildPlan({ config: config(), cases, targets });
    expect(plan.cells).toHaveLength(6);
    expect(plan.cells[0]).toEqual({ caseId: "citations-basic", targetId: "rag" });
    expect(plan.trials).toBe(3);
    expect(plan.concurrency).toBe(4);
    expect(plan.adaptive).toBeUndefined();
  });

  test("config values and adaptive settings are carried", () => {
    const plan = buildPlan({ config: config({ trials: 7, concurrency: 2, adaptive: { ciWidth: 0.2, maxTrials: 9 } }), cases, targets });
    expect(plan.trials).toBe(7);
    expect(plan.concurrency).toBe(2);
    expect(plan.adaptive).toEqual({ ciWidth: 0.2, maxTrials: 9 });
  });

  test("filters by case id, glob, tag and target", () => {
    expect(buildPlan({ config: config(), cases, targets, filter: { cases: ["fix-flaky-test"] } }).cells.map((c) => c.caseId)).toEqual(["fix-flaky-test", "fix-flaky-test"]);
    expect(buildPlan({ config: config(), cases, targets, filter: { cases: ["citations-*"], targets: ["cc"] } }).cells).toEqual([
      { caseId: "citations-basic", targetId: "cc" },
      { caseId: "citations-multi", targetId: "cc" },
    ]);
    expect(buildPlan({ config: config(), cases, targets, filter: { tags: ["smoke"] } }).cells.map((c) => c.caseId)).toEqual(["citations-basic", "citations-basic"]);
    expect(() => buildPlan({ config: config(), cases, targets, filter: { targets: ["nope"] } })).toThrow(/no targets matched/);
    expect(() => buildPlan({ config: config(), cases, targets, filter: { cases: ["zzz"] } })).toThrow(/no cases matched/);
  });
});
