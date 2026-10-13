import { describe, expect, test } from "bun:test";
import valid from "../../test/fixtures/trace.valid.json";
import type { Trace, Trial } from "../core/types";
import { offlineEmbed } from "../providers/embed";
import { chooseK, clusterFailures, kmeans, summarise } from "./cluster";

const base = valid as Trace;

function trial(id: string, mode: "timeout" | "hallucination" | "tamper"): Trial {
  const common = { id, runId: "r", flags: [] as Trial["flags"], pass: false as const, costUsd: 0.01 };
  if (mode === "timeout") return { ...common, trace: { ...base, id, caseId: id, error: "timeout", messages: [{ role: "user", content: "fix the flaky test" }, { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "Bash", arguments: "{}" } }] }] }, scores: [{ scorer: "test_command", value: 0, pass: false, reason: "exit code 124 after timeout" }], flags: ["timeout"] };
  if (mode === "hallucination") return { ...common, trace: { ...base, id, caseId: id, output: "The policy starts in 2027 [c9] and applies to tourists." }, scores: [{ scorer: "rag.citations", value: 0, pass: false, reason: "citation c9 does not resolve to a retrieved chunk" }, { scorer: "rag.faithfulness", value: 0.2, pass: false, reason: "claim about tourists unsupported by context" }] };
  return { ...common, trace: { ...base, id, caseId: id, output: "done", messages: [{ role: "user", content: "make tests pass" }, { role: "assistant", content: "Marked the failing test as skipped so the suite passes." }] }, scores: [{ scorer: "hack", value: 0.3, pass: false, reason: "2 tampering signals: skip-inserted, test-modified" }], flags: ["reward-hack"] };
}

describe("summarise", () => {
  test("captures error, failed scorer reasons, last assistant message, tools and flags", () => {
    const s = summarise(trial("t", "timeout"));
    expect(s).toContain("timeout");
    expect(s).toContain("exit code 124");
    expect(s).toContain("Bash");
    const h = summarise(trial("h", "hallucination"));
    expect(h).toContain("c9");
    expect(h).toContain("unsupported");
  });

  test("an answer taken from hone's cache reads the same as one that ran: the flag is bookkeeping, not what the system did", () => {
    const ran = trial("h", "hallucination");
    const cached = { ...ran, flags: ["cached"] as Trial["flags"] };
    expect(summarise(cached)).toBe(summarise(ran));
    // what the system did stays: a timeout, a reward hack
    expect(summarise({ ...trial("t", "tamper"), flags: ["reward-hack", "cached"] })).toMatch(/flags: reward-hack$/m);
  });
});

describe("kmeans", () => {
  test("separates three obvious groups and chooseK scales with n", () => {
    const pts = [
      [1, 0, 0],
      [0.9, 0.1, 0],
      [0, 1, 0],
      [0.1, 0.9, 0],
      [0, 0, 1],
      [0, 0.1, 0.9],
    ];
    const r = kmeans(pts, 3, { seed: 1 });
    expect(new Set(r.assignments).size).toBe(3);
    expect(r.assignments[0]).toBe(r.assignments[1]);
    expect(r.assignments[2]).toBe(r.assignments[3]);
    expect(r.assignments[4]).toBe(r.assignments[5]);
    expect(chooseK(1)).toBe(1);
    expect(chooseK(8)).toBe(2);
    expect(chooseK(50)).toBe(5);
    expect(chooseK(10_000)).toBe(8);
  });
});

describe("clusterFailures", () => {
  test("groups the three failure modes with the offline embedder and names top terms", async () => {
    const trials = [
      ...["a", "b", "c", "d"].map((i) => trial(`timeout-${i}`, "timeout")),
      ...["a", "b", "c", "d"].map((i) => trial(`halluc-${i}`, "hallucination")),
      ...["a", "b", "c", "d"].map((i) => trial(`tamper-${i}`, "tamper")),
    ];
    const r = await clusterFailures(trials, { k: 3, seed: 3, embed: offlineEmbed });
    expect(r.method).toBe("hash");
    expect(r.clusters).toHaveLength(3);
    for (const c of r.clusters) {
      const prefixes = new Set(c.trialIds.map((id) => id.split("-")[0]));
      expect(prefixes.size).toBe(1);
      expect(c.trialIds).toContain(c.representative);
      expect(c.topTerms.length).toBeGreaterThan(0);
      expect(c.size).toBe(4);
    }
    const tamper = r.clusters.find((c) => c.trialIds[0]!.startsWith("tamper"))!;
    expect(tamper.topTerms.join(" ")).toMatch(/skip|tamper|hack|signals/);
    expect(r.clusters[0]!.size).toBeGreaterThanOrEqual(r.clusters.at(-1)!.size);
  });

  test("passing trials are ignored and no failures gives no clusters", async () => {
    const ok: Trial = { ...trial("ok", "timeout"), pass: true, trace: { ...base, id: "ok" }, flags: [], scores: [] };
    const r = await clusterFailures([ok], { embed: offlineEmbed });
    expect(r.clusters).toEqual([]);
  });
});
