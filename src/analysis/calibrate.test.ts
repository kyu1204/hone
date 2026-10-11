import { describe, expect, test } from "bun:test";
import valid from "../../test/fixtures/trace.valid.json";
import type { ChatMessage, Trace, Trial } from "../core/types";
import type { Scorer } from "../scorers/scorer";
import { calibrate, cohenKappa, FAULTS, inferDomain, rng } from "./calibrate";

const base = valid as Trace;
const a = (c: string, tools: string[] = []): ChatMessage => ({ role: "assistant", content: c, ...(tools.length ? { tool_calls: tools.map((t, i) => ({ id: `${t}${i}`, type: "function" as const, function: { name: t, arguments: "{}" } })) } : {}) });
const t = (id: string, name: string, c = "ok"): ChatMessage => ({ role: "tool", name, tool_call_id: id, content: c });

const ragTrial = (id: string, output: string): Trial => ({ id, runId: "r", trace: { ...base, id, caseId: id, output, spans: [{ ...base.spans[0]!, output: [{ id: "c1", text: "The policy starts on 2026-07-01." }, { id: "c2", text: "Fees are 10 EUR." }] }] }, scores: [], flags: [], pass: true, costUsd: 0 });
const qaTrial = (id: string, output: string): Trial => ({ id, runId: "r", trace: { ...base, id, caseId: id, output, spans: [], messages: [{ role: "user", content: `q ${id}` }, a(output)] }, scores: [], flags: [], pass: true, costUsd: 0 });
const agentTrial = (id: string, bashResult = "3 passed"): Trial => ({
  id,
  runId: "r",
  trace: { ...base, id, caseId: id, output: "Fixed and verified.", spans: [], messages: [{ role: "user", content: "fix" }, a("", ["Read"]), t("Read0", "Read", "file"), a("Implemented the fix, done.", ["Edit"]), t("Edit0", "Edit", "ok"), a("", ["Bash"]), t("Bash0", "Bash", bashResult), a("Fixed and verified.")] },
  scores: [],
  flags: [],
  pass: true,
  costUsd: 0,
});

describe("fault injectors", () => {
  const r = rng(1);
  test("rag: unsupported-claim appends a sentence; wrong-citation points at another chunk", () => {
    const x = ragTrial("x", "The policy starts on 2026-07-01 [c1].");
    const claim = FAULTS.rag["unsupported-claim"]!(x, r, [])!;
    expect(String(claim.trace.output).length).toBeGreaterThan(String(x.trace.output).length);
    expect(claim.trace.output).toContain("[c1]");
    const cite = FAULTS.rag["wrong-citation"]!(x, r, [])!;
    expect(cite.trace.output).toBe("The policy starts on 2026-07-01 [c2].");
    expect(FAULTS.rag["wrong-citation"]!(ragTrial("y", "no citation here"), r, [])).toBeUndefined();
  });

  test("qa: answer-swapped takes another case's output; negated flips a number or inserts not", () => {
    const p = qaTrial("p", "The capital is Paris.");
    const q = qaTrial("q", "There are 12 months.");
    expect(FAULTS.qa["answer-swapped"]!(p, r, [p, q])!.trace.output).toBe("There are 12 months.");
    expect(FAULTS.qa["answer-swapped"]!(p, r, [p])).toBeUndefined();
    expect(FAULTS.qa.negated!(q, r, [])!.trace.output).toBe("There are 13 months.");
    expect(FAULTS.qa.negated!(p, r, [])!.trace.output).toBe("The capital is not Paris.");
    expect(FAULTS.qa.negated!(qaTrial("z", "yes"), r, [])).toBeUndefined();
  });

  test("agent: verification-removed drops the Bash call and result; tool-result-swapped and premature-done", () => {
    const g = agentTrial("g");
    const removed = FAULTS.agent["verification-removed"]!(g, r, [])!;
    expect(removed.trace.messages).toHaveLength(6);
    expect(removed.trace.messages.some((m) => m.role === "tool" && m.name === "Bash")).toBe(false);
    expect(removed.trace.messages.at(-1)!.content).toBe("Fixed and verified.");
    const other = agentTrial("h", "0 passed, 2 failed");
    const swapped = FAULTS.agent["tool-result-swapped"]!(g, r, [g, other])!;
    expect(swapped.trace.messages.find((m) => m.role === "tool" && m.name === "Bash")!.content).toBe("0 passed, 2 failed");
    expect(FAULTS.agent["tool-result-swapped"]!(g, r, [g])).toBeUndefined();
    const early = FAULTS.agent["premature-done"]!(g, r, [])!;
    expect(early.trace.messages).toHaveLength(4);
    expect(early.trace.output).toBe("Implemented the fix, done.");
    expect(FAULTS.agent["premature-done"]!(qaTrial("k", "done"), r, [])).toBeUndefined();
  });

  test("injected trials carry the fault in meta and do not mutate the original", () => {
    const x = ragTrial("x", "A [c1].");
    const y = FAULTS.rag["unsupported-claim"]!(x, r, [])!;
    expect(y.trace.meta?.injectedFault).toBe("unsupported-claim");
    expect(x.trace.output).toBe("A [c1].");
  });
});

describe("inferDomain and kappa", () => {
  test("retrieval spans mean rag, tool calls mean agent, otherwise qa", () => {
    expect(inferDomain([ragTrial("a", "x")])).toBe("rag");
    expect(inferDomain([agentTrial("b")])).toBe("agent");
    expect(inferDomain([qaTrial("c", "x")])).toBe("qa");
  });
  test("cohenKappa", () => {
    expect(cohenKappa([true, true, false, false], [true, true, false, false])).toBeCloseTo(1, 9);
    expect(cohenKappa([true, true, false, false], [true, false, true, false])).toBeCloseTo(0, 9);
    expect(cohenKappa([true, true], [true, true])).toBe(1);
  });
});

describe("calibrate", () => {
  test("detection rates with Wilson intervals, false alarms, kappa against labels", async () => {
    const trials = ["a", "b", "c", "d"].map((id) => agentTrial(id, `${id} passed`));
    // Catches missing verification and premature completion, never swapped results; flags trial d even when clean.
    const scorer: Scorer = {
      name: "verifier",
      score({ trace }) {
        const ranTests = trace.messages.some((m) => m.role === "tool" && m.name === "Bash");
        const claimsDone = /verified/i.test(String(trace.output));
        const pass = ranTests && claimsDone && trace.caseId !== "d";
        return { scorer: "", value: pass ? 1 : 0, pass };
      },
    };
    const file = await calibrate({ trials, scorer, domain: "agent", n: 4, seed: 7, labels: new Map([["a", true], ["b", true], ["c", true], ["d", false]]) });
    expect(file.schemaVersion).toBe(1);
    expect(file.judge).toBe("verifier");
    expect(file.domain).toBe("agent");
    const by = Object.fromEntries(file.faults.map((f) => [f.type, f]));
    expect(by["verification-removed"]).toMatchObject({ injected: 4, detected: 4, rate: 1 });
    expect(by["premature-done"]).toMatchObject({ injected: 4, detected: 4 });
    expect(by["tool-result-swapped"]).toMatchObject({ injected: 4, detected: 1, rate: 0.25 });
    expect(by["verification-removed"]!.lo).toBeGreaterThan(0.3);
    expect(by["verification-removed"]!.hi).toBe(1);
    expect(file.falseAlarms).toEqual({ n: 4, flagged: 1, rate: 0.25 });
    expect(file.kappa).toBeCloseTo(1, 9);
  });

  test("only passing trials are used, n caps the sample, no labels means no kappa", async () => {
    const trials = [...["a", "b", "c"].map((id) => qaTrial(id, `The answer is ${id} 1.`)), { ...qaTrial("f", "x 2"), pass: false as const }];
    const scorer: Scorer = { name: "always-pass", score: () => ({ scorer: "", value: 1, pass: true }) };
    const file = await calibrate({ trials, scorer, domain: "qa", n: 2, seed: 1 });
    expect(file.falseAlarms.n).toBe(2);
    expect(file.faults.find((f) => f.type === "negated")).toMatchObject({ injected: 2, detected: 0, rate: 0, lo: 0 });
    expect(file.kappa).toBeUndefined();
  });
});
