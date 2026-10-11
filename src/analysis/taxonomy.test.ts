import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../test/fixtures/trace.valid.json";
import type { FailureCode, Trace, Trial } from "../core/types";
import type { JevQuestion, JevResult } from "../providers/jev";
import type { FailureCluster } from "./cluster";
import { classify, induceTaxonomy, parseCodeJson, readTaxonomy, writeTaxonomy } from "./taxonomy";

const base = valid as Trace;

const clusters: FailureCluster[] = [
  { id: "cluster-1", size: 3, trialIds: ["a", "b", "c"], representative: "a", topTerms: ["timeout", "exit", "124"], summaries: ["error: timeout", "error: timeout after 600s", "test_command: exit code 124"] },
  { id: "cluster-2", size: 2, trialIds: ["d", "e"], representative: "d", topTerms: ["skip", "tampering"], summaries: ["hack: skip-inserted", "hack: test-modified"] },
];

function stubChat(replies: Record<string, unknown>[]): { chat: (req: { messages: { content: unknown }[] }) => Promise<{ text: string }>; prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    prompts,
    chat: async (req) => {
      prompts.push(JSON.stringify(req.messages));
      const r = replies[Math.min(i++, replies.length - 1)]!;
      return { text: i % 2 === 0 ? `\`\`\`json\n${JSON.stringify(r)}\n\`\`\`` : JSON.stringify(r) };
    },
  };
}

function stubJev(answer: (state: unknown, q: Record<string, JevQuestion>) => JevResult["answers"]): { ask: (state: unknown, q: Record<string, JevQuestion>) => Promise<JevResult>; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    ask: async (state, q) => {
      calls.push(state);
      return { answers: answer(state, q), usage: { input_tokens: 10, output_tokens: 0 }, model: "jev", costUsd: 0.000001 };
    },
  };
}

describe("parseCodeJson", () => {
  test("accepts bare and fenced JSON, normalises code to kebab-case, defaults axis", () => {
    expect(parseCodeJson('{"code":"Timeout No Progress","axis":"system","definition":"d","evidencePatterns":["x"]}')).toEqual({ code: "timeout-no-progress", axis: "system", definition: "d", evidencePatterns: ["x"] });
    expect(parseCodeJson('```json\n{"code":"a_b","definition":"d"}\n```')).toEqual({ code: "a-b", axis: "system", definition: "d", evidencePatterns: [] });
    expect(parseCodeJson("not json")).toBeUndefined();
  });
});

describe("induceTaxonomy", () => {
  test("one chat call per cluster, codes in cluster order, summaries in the prompt", async () => {
    const { chat, prompts } = stubChat([
      { code: "timeout-no-progress", axis: "system", definition: "The agent runs past the time limit without finishing.", evidencePatterns: ["exit code 124", "timeout"] },
      { code: "test-tampering", axis: "role", definition: "Tests are skipped or edited instead of fixed.", evidencePatterns: ["skip-inserted"] },
    ]);
    const codes = await induceTaxonomy(clusters, { chat });
    expect(codes.map((c) => c.code)).toEqual(["timeout-no-progress", "test-tampering"]);
    expect(codes[1]!.axis).toBe("role");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("exit code 124");
    expect(prompts[1]).toContain("skip-inserted");
  });

  test("merges with an existing taxonomy by identical code or by Jev agreement", async () => {
    const existing: FailureCode[] = [
      { code: "timeout-no-progress", axis: "system", definition: "Existing definition kept.", evidencePatterns: ["timeout"] },
      { code: "reward-hacking", axis: "role", definition: "Gaming the scorer.", evidencePatterns: ["skip"] },
    ];
    const { chat } = stubChat([
      { code: "timeout-no-progress", definition: "new wording", evidencePatterns: [] },
      { code: "skipping-tests", definition: "Marks tests skipped.", evidencePatterns: ["skip-inserted"] },
    ]);
    const jev = stubJev((_state, q) => Object.fromEntries(Object.keys(q).map((k) => [k, { type: "noul" as const, noul: k === "reward-hacking" ? 0.92 : 0.1 }])));
    const codes = await induceTaxonomy(clusters, { chat, existing, jev });
    expect(codes.map((c) => c.code)).toEqual(["timeout-no-progress", "reward-hacking"]);
    expect(codes[0]!.definition).toBe("Existing definition kept.");
    expect(jev.calls).toHaveLength(1);
    const noJev = await induceTaxonomy(clusters, { chat: stubChat([{ code: "x", definition: "d" }, { code: "y", definition: "e" }]).chat, existing });
    expect(noJev.map((c) => c.code)).toEqual(["x", "y"]);
  });

  test("a cluster whose reply cannot be parsed falls back to its provisional code", async () => {
    const chat = async (): Promise<{ text: string }> => ({ text: "sorry" });
    const codes = await induceTaxonomy(clusters, { chat });
    expect(codes.map((c) => c.code)).toEqual(["cluster-1", "cluster-2"]);
    expect(codes[0]!.evidencePatterns).toEqual(["timeout", "exit", "124"]);
  });
});

describe("classify", () => {
  test("one Jev choice per trial over codes plus other", async () => {
    const codes: FailureCode[] = [
      { code: "timeout-no-progress", axis: "system", definition: "d1", evidencePatterns: [] },
      { code: "test-tampering", axis: "role", definition: "d2", evidencePatterns: [] },
    ];
    const trials: Trial[] = ["a", "b", "c"].map((id) => ({ id, runId: "r", trace: { ...base, id, caseId: id, error: id === "a" ? "timeout" : undefined }, scores: [], flags: [], pass: false, costUsd: 0 }));
    const jev = stubJev((state, q) => {
      const s = JSON.stringify(state);
      const pick = s.includes("timeout") ? "timeout-no-progress" : s.includes('"b"') ? "test-tampering" : "other";
      expect(Object.keys((q.code as { criteria: Record<string, unknown> }).criteria)).toEqual(["timeout-no-progress", "test-tampering", "other"]);
      return { code: { type: "choice", choice: pick, probabilities: { [pick]: 0.8 }, confidence: 0.8 } };
    });
    const out = await classify(trials, codes, { jev });
    expect(out.get("a")).toEqual({ code: "timeout-no-progress", confidence: 0.8 });
    expect(out.get("b")!.code).toBe("test-tampering");
    expect(out.get("c")!.code).toBe("other");
    expect(jev.calls).toHaveLength(3);
  });
});

describe("taxonomy file", () => {
  test("round trips through .hone/taxonomy.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-tax-"));
    expect(readTaxonomy(root)).toBeUndefined();
    const codes: FailureCode[] = [{ code: "a", axis: "system", definition: "d", evidencePatterns: [] }];
    writeTaxonomy(root, codes);
    const file = readTaxonomy(root)!;
    expect(file.schemaVersion).toBe(1);
    expect(file.codes).toEqual(codes);
    expect(Date.parse(file.updatedAt)).toBeGreaterThan(0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
