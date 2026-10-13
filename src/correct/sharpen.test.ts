import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HoneConfig } from "../core/config";
import { sharpen, splitCases } from "./sharpen";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-sharpen-"));
  dirs.push(d);
  return d;
};

const idOf = (input: unknown): string => `c${String(input).slice(1)}`;
const even = (id: string): boolean => Number(id.slice(1)) % 2 === 0;

/** A system that answers a case correctly when `passes(caseId, text, variant)` says so; the text and the variant are what sharpen may change. */
function config(passes: (id: string, text: string, variant: string | undefined) => boolean, opts: { n?: number; text?: boolean; variants?: string[] } = {}): HoneConfig {
  const make = (text: string, variant: string | undefined): HoneConfig["targets"] => ({
    t: { kind: "fn", text, variant, version: `${variant ?? "base"}|${text}`, fn: (input: unknown) => (passes(idOf(input), text, variant) ? String(input).toUpperCase() : String(input)) },
  });
  const sharpenBlock: NonNullable<HoneConfig["sharpen"]> = {};
  if (opts.text) sharpenBlock.text = { seed: "Answer.", apply: (c, text) => ({ ...c, targets: make(text, c.targets.t!.variant as string | undefined) }) };
  if (opts.variants) sharpenBlock.variants = Object.fromEntries(opts.variants.map((v) => [v, (c: HoneConfig) => ({ ...c, targets: make(String(c.targets.t!.text), v) })]));
  return {
    targets: make("Answer.", undefined),
    cases: Array.from({ length: opts.n ?? 30 }, (_, i) => ({ id: `c${i}`, input: `w${i}`, expected: `W${i}` })),
    trials: 1,
    scorers: [{ name: "exact" }],
    ...(opts.text || opts.variants ? { sharpen: sharpenBlock } : {}),
  };
}

/** One reply serves both uses of the model: naming a failure mode (code, definition) and rewriting the text (text, rationale). */
function stubChat(text: (prompt: string) => string = () => "Answer in UPPERCASE."): { chat: (req: { messages: { content: unknown }[] }) => Promise<{ text: string }>; prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    chat: async (req) => {
      const prompt = JSON.stringify(req.messages);
      prompts.push(prompt);
      return { text: JSON.stringify({ text: text(prompt), rationale: "outputs were lowercase", code: "answers-lowercase", definition: "outputs were not capitalised" }) };
    },
  };
}

describe("splitCases", () => {
  const ids = Array.from({ length: 30 }, (_, i) => `c${i}`);
  test("a third is held out, the same third for the same seed, another for another seed", () => {
    const a = splitCases(ids);
    expect(a.inSample).toBe(false);
    expect(a.holdout).toHaveLength(10);
    expect(a.dev).toHaveLength(20);
    expect([...a.dev, ...a.holdout].sort()).toEqual([...ids].sort());
    expect(splitCases([...ids].reverse()).holdout.sort()).toEqual([...a.holdout].sort());
    expect(splitCases(ids, 1 / 3, 2).holdout.sort()).not.toEqual([...a.holdout].sort());
    expect(splitCases(ids, 0.5).holdout).toHaveLength(15);
  });
  test("with too few cases nothing is held out", () => {
    expect(splitCases(ids.slice(0, 11))).toEqual({ dev: ids.slice(0, 11), holdout: [], inSample: true });
    expect(splitCases(ids.slice(0, 20), 0.1).inSample).toBe(true); // 2 held out would be too few to compare
  });
});

describe("sharpen", () => {
  test("a rewrite that fixes the failures is proven on cases no proposal ever saw", async () => {
    const cwd = tmp();
    const { chat, prompts } = stubChat();
    const r = await sharpen({ config: config((_id, text) => text.includes("UPPERCASE"), { text: true }), hash: "h", cwd, chat, budget: 2, useCache: false });
    expect(r.split).toMatchObject({ inSample: false });
    expect(r.split.holdout).toHaveLength(10);
    expect(r.baseline).toMatchObject({ dev: 0, trials: 20, errors: 0 });
    expect(r.diagnosis[0]).toMatchObject({ code: "answers-lowercase", definition: "outputs were not capitalised" });
    expect(r.diagnosis.reduce((s, d) => s + d.size, 0)).toBe(20);
    expect(r.split.dev).toContain(r.diagnosis[0]!.example);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ id: "rewrite 1", kind: "text", parent: "baseline", text: "Answer in UPPERCASE.", rationale: "outputs were lowercase", dev: 1 });
    expect(r.candidates[0]!.sample).toEqual({ cases: 20, candidate: 1, parent: 0 });
    expect(r.best).toMatchObject({ id: "rewrite 1", cases: 10, baseline: 0, candidate: 1, diff: 1, p: 0 });
    expect(r.verdict).toBe("proven");
    expect(r.stopped).toBe("exhausted"); // nothing fails any more, so there is nothing left to propose from
    for (const p of prompts) for (const id of r.split.holdout) expect(p).not.toMatch(new RegExp(`\\b${id}\\b`));
    expect(JSON.parse(fs.readFileSync(r.path, "utf8"))).toMatchObject({ id: r.id, verdict: "proven" });
    expect(r.path).toBe(path.join(cwd, ".hone", "sharpen", `${r.id}.json`));
    expect(fs.readFileSync(path.join(cwd, ".hone", "sharpen", `${r.id}-best.txt`), "utf8")).toBe("Answer in UPPERCASE.");
    expect(r.message).toMatch(/^Now: 0% of 20 cases pass\. 10 more cases are held out for the final check\./);
    expect(r.message).toMatch(/1\. answers-lowercase \(20 of 20 failed trials\): outputs were not capitalised, e\.g\. c\d+/);
    expect(r.message).toMatch(/\+ rewrite 1\s+0% -> 100%\s+outputs were lowercase/);
    expect(r.message).toMatch(/Result: PROVEN\. On 10 cases it never saw, rewrite 1 takes the pass rate from 0% to 100%/);
    expect(r.message).toContain(`.hone/sharpen/${r.id}-best.txt`);
  });

  test("a variant and a rewrite that each fix half combine without anyone deciding to combine them", async () => {
    const { chat } = stubChat();
    const cfg = config((id, text, variant) => (even(id) ? variant === "wide" : text.includes("UPPERCASE")), { text: true, variants: ["wide"] });
    const r = await sharpen({ config: cfg, hash: "h", cwd: tmp(), chat, budget: 3, useCache: false });
    expect(r.candidates.map((c) => c.id)).toEqual(["variant wide", "rewrite 1"]);
    expect(r.candidates[0]!.dev).toBeGreaterThan(0.2);
    expect(r.candidates[0]!.dev).toBeLessThan(0.8);
    expect(r.candidates[1]).toMatchObject({ kind: "text", parent: "variant wide", variant: "wide", text: "Answer in UPPERCASE.", dev: 1 });
    expect(r.best).toMatchObject({ id: "rewrite 1", baseline: 0, candidate: 1 });
    expect(r.verdict).toBe("proven");
    expect(r.message).toMatch(/variant wide \+ rewrite 1|rewrite 1 \(on variant wide\)/);
  });

  test("a rewrite that only fits the cases it learned from is not adopted", async () => {
    // the system passes a case only when the text names it; the proposer sees dev failures and names exactly those
    const naming = (prompt: string): string => `Answer. ${[...new Set([...prompt.matchAll(/case (c\d+)/g)].map((m) => `[${m[1]}]`))].join("")}`;
    const { chat } = stubChat(naming);
    const r = await sharpen({ config: config((id, text) => text.includes(`[${id}]`), { text: true }), hash: "h", cwd: tmp(), chat, budget: 1, useCache: false });
    expect(r.candidates[0]!.dev).toBeGreaterThan(0);
    expect(r.best).toMatchObject({ id: "rewrite 1", baseline: 0, candidate: 0, diff: 0 });
    expect(r.verdict).toBe("no gain");
    expect(r.message).toMatch(/Result: NO GAIN\. rewrite 1 looked better on the cases it learned from \(0% -> \d+%\) but not on 10 cases it never saw \(0% -> 0%\)/);
  });

  test("with too few cases to hold any out the verdict stops at promising", async () => {
    const { chat } = stubChat();
    const r = await sharpen({ config: config((_id, text) => text.includes("UPPERCASE"), { text: true, n: 8 }), hash: "h", cwd: tmp(), chat, budget: 1, useCache: false });
    expect(r.split).toMatchObject({ inSample: true, holdout: [] });
    expect(r.best).toMatchObject({ cases: 8, baseline: 0, candidate: 1 });
    expect(r.verdict).toBe("promising");
    expect(r.message).toMatch(/Too few cases to hold any out/);
    expect(r.message).toMatch(/Result: PROMISING, not proven\./);
  });

  test("gates: a system that does not run, a suite that passes, a config with nothing to change", async () => {
    const boom = config(() => false, { text: true });
    boom.targets = { t: { kind: "fn", fn: () => { throw new Error("boom: connection refused"); } } };
    const broken = await sharpen({ config: boom, hash: "h", cwd: tmp(), chat: stubChat().chat, useCache: false });
    expect(broken.verdict).toBe("cannot measure");
    expect(broken.candidates).toEqual([]);
    expect(broken.message).toMatch(/Cannot measure: the system failed to run in 20 of 20 trials \(first error: .*boom: connection refused/);

    const fine = await sharpen({ config: config(() => true, { text: true }), hash: "h", cwd: tmp(), chat: stubChat().chat, useCache: false });
    expect(fine.verdict).toBe("nothing to sharpen");
    expect(fine.message).toMatch(/Nothing to sharpen: all 20 cases pass/);

    const { chat, prompts } = stubChat();
    const bare = await sharpen({ config: config(() => false), hash: "h", cwd: tmp(), chat, useCache: false });
    expect(bare.verdict).toBe("nothing to change");
    expect(bare.diagnosis[0]).toMatchObject({ code: "answers-lowercase" });
    expect(bare.message).toMatch(/Why it fails:/);
    expect(bare.message).toMatch(/sharpen: \{ text: \{ seed, apply \} \}/);
    expect(prompts.length).toBeGreaterThan(0); // the model named the failure modes
    expect(prompts.some((p) => p.includes("Current text"))).toBe(false); // and was not asked for rewrites

    const noKey = await sharpen({ config: config(() => false, { text: true }), hash: "h", cwd: tmp(), useCache: false });
    expect(noKey.verdict).toBe("nothing to change");
    expect(noKey.diagnosis[0]!.code).toBe("cluster-1");
    expect(noKey.message).toMatch(/ANTHROPIC_API_KEY or OPENAI_API_KEY/);
  });

  test("budget, max cost and a target score each stop the loop", async () => {
    const dud = config(() => false, { variants: ["a", "b", "c"] });
    const budget = await sharpen({ config: dud, hash: "h", cwd: tmp(), budget: 2, useCache: false });
    expect(budget.candidates.map((c) => c.id)).toEqual(["variant a", "variant b"]);
    expect(budget.stopped).toBe("budget");
    expect(budget.verdict).toBe("no gain");
    expect(budget.message).toMatch(/Result: NO GAIN\. None of the 2 changes beat what you have\./);

    const cost = await sharpen({ config: dud, hash: "h", cwd: tmp(), maxCost: 0, useCache: false });
    expect(cost.candidates).toEqual([]);
    expect(cost.stopped).toBe("maxCost");

    const { chat, prompts } = stubChat();
    const half = config((id, text, variant) => (even(id) ? variant === "wide" : text.includes("UPPERCASE")), { text: true, variants: ["wide"] });
    const until = await sharpen({ config: half, hash: "h", cwd: tmp(), chat, until: 0.3, useCache: false });
    expect(until.candidates.map((c) => c.id)).toEqual(["variant wide"]);
    expect(until.stopped).toBe("until");
    expect(prompts.some((p) => p.includes("Current text"))).toBe(false); // no rewrite was requested
  });
});
