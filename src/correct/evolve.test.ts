import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HoneConfig } from "../core/config";
import { evolve, isDominated, parseProposal } from "./evolve";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function config(seed: string): HoneConfig {
  return {
    targets: {},
    cases: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, input: `w${i}`, expected: `W${i}` })),
    scorers: [{ name: "exact" }],
    evolve: {
      seed,
      apply: (c, text) => ({ ...c, targets: { t: { kind: "fn", fn: (i: unknown) => (text.includes("UPPERCASE") ? String(i).toUpperCase() : String(i)), version: text } } }),
    },
  };
}

function stubChat(replies: string[]): { chat: (req: { messages: { content: unknown }[]; maxTokens?: number }) => Promise<{ text: string }>; prompts: string[]; maxTokens: number[] } {
  const prompts: string[] = [];
  const maxTokens: number[] = [];
  let i = 0;
  return { prompts, maxTokens, chat: async (req) => (prompts.push(JSON.stringify(req.messages)), maxTokens.push(req.maxTokens ?? 0), { text: replies[Math.min(i++, replies.length - 1)]! }) };
}

describe("parseProposal and isDominated", () => {
  test("bare or fenced JSON with text; anything else is undefined", () => {
    expect(parseProposal('{"text":"A","rationale":"r"}')).toEqual({ text: "A", rationale: "r" });
    expect(parseProposal('```json\n{"text":"B"}\n```')).toEqual({ text: "B", rationale: "" });
    expect(parseProposal("nope")).toBeUndefined();
  });
  test("dominated when another is at least as good on both axes and better on one", () => {
    const a = { passAt1: 0.5, costUsd: 1 };
    expect(isDominated(a, [{ passAt1: 0.6, costUsd: 1 }])).toBe(true);
    expect(isDominated(a, [{ passAt1: 0.5, costUsd: 0.5 }])).toBe(true);
    expect(isDominated(a, [{ passAt1: 0.6, costUsd: 2 }])).toBe(false);
    expect(isDominated(a, [a])).toBe(false);
  });
});

describe("evolve", () => {
  test("a reflection that fixes the failures joins the front and beats the baseline; junk replies are skipped", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hone-evolve-"));
    dirs.push(cwd);
    const cfg = config("Answer the question.");
    const { chat, prompts, maxTokens } = stubChat(['{"text":"Answer in UPPERCASE.","rationale":"outputs were lowercase"}', "I cannot help"]);
    const r = await evolve({ config: cfg, hash: "h", cwd, chat, budget: 2, minibatch: 4, useCache: false });
    expect(Math.min(...maxTokens)).toBeGreaterThanOrEqual(4096); // long rewrites must not be truncated into invalid JSON
    expect(r.file.kind).toBe("evolve");
    expect(r.file.baseline.passAt1).toBe(0);
    expect(r.file.candidates).toHaveLength(2);
    const ok = r.file.candidates[0]!;
    expect(ok).toMatchObject({ text: "Answer in UPPERCASE.", passAt1: 1, pareto: true, parent: "baseline", rationale: "outputs were lowercase" });
    expect(ok.lo).toBeGreaterThan(0.6);
    expect(r.file.candidates[1]).toMatchObject({ rejected: "unparseable" });
    expect(r.file.baseline.pareto).toBe(false);
    expect(r.verdict).toMatch(/cand-1 beats baseline/);
    expect(prompts[0]).toContain("Answer the question.");
    expect(prompts[0]).toMatch(/exact/);
    expect(fs.existsSync(path.join(cwd, ".hone", "evolve", `${r.id}.json`))).toBe(true);
    expect(fs.readFileSync(path.join(cwd, ".hone", "evolve", `${r.id}-cand-1.txt`), "utf8")).toBe("Answer in UPPERCASE.");
  });

  test("a worse proposal is rejected on the minibatch and the verdict is no measurable effect", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hone-evolve2-"));
    dirs.push(cwd);
    const cfg = config("Answer in UPPERCASE.");
    const { chat } = stubChat(['{"text":"Answer in lowercase.","rationale":"shorter"}']);
    const r = await evolve({ config: cfg, hash: "h", cwd, chat, budget: 1, minibatch: 3, useCache: false });
    expect(r.file.baseline.passAt1).toBe(1);
    expect(r.file.candidates[0]).toMatchObject({ rejected: "minibatch", pareto: false });
    expect(r.file.candidates[0]!.minibatch).toEqual({ cases: 3, candidate: 0, parent: 1 });
    expect(r.file.baseline.pareto).toBe(true);
    expect(r.verdict).toBe("no measurable effect");
  });

  test("maxCost of zero stops before any candidate", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hone-evolve3-"));
    dirs.push(cwd);
    const { chat, prompts } = stubChat(['{"text":"x"}']);
    const r = await evolve({ config: config("seed"), hash: "h", cwd, chat, budget: 3, maxCost: 0, useCache: false });
    expect(r.file.candidates).toEqual([]);
    expect(prompts).toHaveLength(0);
    expect(r.stopped).toBe("maxCost");
  });
});
