import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HoneConfig } from "../core/config";
import { loadChanges } from "./change";
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

/** Sentences of the account wrap at 100 columns; match them with the line breaks taken out. */
const flat = (s: string): string => s.replace(/\s+/g, " ");
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
  test("cases that declare the same cluster stay on the same side", () => {
    const paired = Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, cluster: `fact-${Math.floor(i / 2)}` }));
    const s = splitCases(paired);
    expect(s.inSample).toBe(false);
    expect(s.holdout.length).toBeGreaterThanOrEqual(8);
    const side = new Map<string, Set<string>>();
    for (const c of paired) (side.get(c.cluster) ?? side.set(c.cluster, new Set()).get(c.cluster)!).add(s.holdout.includes(c.id) ? "holdout" : "dev");
    for (const sides of side.values()) expect(sides.size).toBe(1);
    expect(splitCases(Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, cluster: "one" }))).inSample).toBe(true); // one cluster cannot be split
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
    expect(r.best).toMatchObject({ id: "rewrite 1", cases: 10, baseline: 0, candidate: 1, diff: 1 });
    expect(r.best!.p).toBeCloseTo(2 * 0.5 ** 10, 6); // ten of ten improved: an exact sign test, not "no variance, so p = 0"
    expect(r.verdict).toBe("proven");
    expect(r.stopped).toBe("exhausted"); // nothing fails any more, so there is nothing left to propose from
    for (const p of prompts) for (const id of r.split.holdout) expect(p).not.toMatch(new RegExp(`\\b${id}\\b`));
    expect(JSON.parse(fs.readFileSync(r.path, "utf8"))).toMatchObject({ id: r.id, verdict: "proven" });
    expect(r.path).toBe(path.join(cwd, ".hone", "sharpen", `${r.id}.json`));
    expect(fs.readFileSync(path.join(cwd, ".hone", "sharpen", `${r.id}-best.txt`), "utf8")).toBe("Answer in UPPERCASE.");
    expect(r.message).toMatch(/^Now: 0% of 20 cases pass\. 10 more cases are held out for the final check\./);
    expect(r.message).toMatch(/1\. answers-lowercase \(20 of 20 failed trials, e\.g\. c\d+\)\n {5}outputs were not capitalised\n/);
    // the account fits a terminal: no line runs past 100 columns
    expect(Math.max(...r.message.split("\n").map((l) => l.length))).toBeLessThanOrEqual(100);
    expect(r.message).toMatch(/\+ rewrite 1\s+0% -> 100%\s+outputs were lowercase/);
    expect(flat(r.message)).toMatch(/Result: PROVEN\. On 10 cases it never saw, rewrite 1 takes the pass rate from 0% to 100%/);
    expect(r.message).toContain(`.hone/sharpen/${r.id}-best.txt`);
  });

  test("the diagnosis is a file a proposer can read: modes with example cases, what may change, and no held-out case", async () => {
    const cwd = tmp();
    const { chat } = stubChat();
    const cfg = config((_id, text) => text.includes("UPPERCASE"), { text: true, variants: ["wide"] });
    const r = await sharpen({ config: cfg, changes: [{ name: "idea", why: "w", config: (c) => c, file: "sharpen/idea.ts" }], hash: "h", cwd, chat, budget: 0, useCache: false });
    // budget 0 is the proposer's first step: measure, diagnose, write the file, try nothing
    expect(r.candidates).toEqual([]);
    expect(r.stopped).toBe("budget");
    expect(flat(r.message)).toMatch(/Result: NO GAIN\. Nothing was tried\./);
    expect(r.message).not.toMatch(/Tried 0/);
    expect(r.diagnosisPath).toBe(path.join(cwd, ".hone", "sharpen", `${r.id}-diagnosis.md`));
    expect(r.message).toContain(`  Examples of each, and how to write a change: .hone/sharpen/${r.id}-diagnosis.md`);
    const md = fs.readFileSync(r.diagnosisPath!, "utf8");
    expect(md).toMatch(/^# Why cases fail\n/);
    expect(md).toContain("0% of 20 cases pass");
    expect(md).toContain("10 more cases are held out and do not appear here");
    expect(md).toMatch(/## 1\. answers-lowercase \(20 of 20 failed trials\)\n\noutputs were not capitalised/);
    // an example case with what went in, what was expected, what came out and why it failed
    const example = r.diagnosis[0]!.cases[0]!;
    const n = example.slice(1);
    expect(md).toContain(`### ${example}`);
    expect(md).toContain(`- input: w${n}`);
    expect(md).toContain(`- expected: W${n}`);
    expect(md).toContain(`- output: w${n}`);
    expect(md).toMatch(/- exact: .+/);
    expect((md.match(/^### /gm) ?? []).length).toBe(3); // three examples per mode, not all twenty
    expect(r.diagnosis[0]!.cases).toHaveLength(20);
    for (const id of r.split.holdout) expect(md).not.toMatch(new RegExp(`\\b${id}\\b`));
    // what may change, and a change file to start from
    expect(md).toContain("## What may change");
    expect(md).toContain("> Answer.");
    expect(md).toContain("- variants in the config: wide");
    expect(md).toContain("- change files: sharpen/idea.ts (idea)");
    expect(md).toContain('import { change } from "hone-eval";');
  });

  test("long wording from a model is cut so that no line of the account runs past 100 columns", async () => {
    const long = "the assistant wraps the requested value in a long conversational sentence with greetings and thanks, ".repeat(3);
    const chat = async (): Promise<{ text: string }> => ({ text: JSON.stringify({ text: "Answer in UPPERCASE.", rationale: long, code: "a-rather-long-failure-mode-name-from-the-model", definition: long }) });
    const r = await sharpen({ config: config((_id, text) => text.includes("UPPERCASE"), { text: true }), hash: "h", cwd: tmp(), chat, budget: 1, useCache: false });
    expect(r.verdict).toBe("proven");
    expect(Math.max(...r.message.split("\n").map((l) => l.length))).toBeLessThanOrEqual(100);
    expect(r.message).toMatch(/\n {5}the assistant wraps the requested value .*\.\.\.\n/);
    expect(r.candidates[0]!.rationale).toBe(long); // the ledger keeps it whole
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

  test("a variant that only helps together with a rewrite is tried again on top of it", async () => {
    // nothing passes until the text is rewritten; after that the variant fixes the other half
    const { chat } = stubChat();
    const cwd = tmp();
    const cfg = config((id, text, variant) => text.includes("UPPERCASE") && (even(id) || variant === "wide"), { text: true, variants: ["wide"] });
    const r = await sharpen({ config: cfg, hash: "h", cwd, chat, budget: 4, useCache: false });
    expect(r.candidates.map((c) => c.id)).toEqual(["variant wide", "rewrite 1", "variant wide on rewrite 1"]);
    expect(r.candidates[0]).toMatchObject({ dev: 0, parent: "baseline" });
    expect(r.candidates[1]!.dev).toBeGreaterThan(0.2);
    expect(r.candidates[1]!.dev).toBeLessThan(0.8);
    expect(r.candidates[2]).toMatchObject({ kind: "variant", parent: "rewrite 1", variant: "wide", text: "Answer in UPPERCASE.", dev: 1 });
    expect(r.best).toMatchObject({ id: "variant wide on rewrite 1", label: "variant wide on rewrite 1", baseline: 0, candidate: 1 });
    expect(r.verdict).toBe("proven");
    expect(flat(r.message)).toMatch(/Result: PROVEN\. On 10 cases it never saw, variant wide on rewrite 1 takes the pass rate from 0% to 100%/);
    expect(r.message).toContain(`The new text is in .hone/sharpen/${r.id}-best.txt`);
    expect(flat(r.message)).toContain('It uses the variant "wide" from sharpen.variants.');
    expect(fs.readFileSync(path.join(cwd, ".hone", "sharpen", `${r.id}-best.txt`), "utf8")).toBe("Answer in UPPERCASE.");
    // the saved change file is the rewrite itself, under its own name and with the model's reason, not the pairing
    const saved = fs.readFileSync(path.join(cwd, ".hone", "sharpen", `${r.id}-best.ts`), "utf8");
    expect(saved).toContain('change("rewrite 1", {');
    expect(saved).toContain('why: "outputs were lowercase"');
    expect(saved).toContain('the variant "wide" (sharpen.variants)');
    // a pairing row does not repeat the reason of the change it reuses
    expect(r.message).toMatch(/\+ variant wide on rewrite 1\s+0% -> 100%\n/);
  });

  test("a text from a change file is proven without any model", async () => {
    const cwd = tmp();
    const r = await sharpen({
      config: config((_id, text) => text.includes("UPPERCASE"), { text: true }),
      changes: [{ name: "uppercase", why: "outputs were lowercase", text: "Answer in UPPERCASE.", file: "sharpen/up.ts" }],
      hash: "h",
      cwd,
      useCache: false,
    });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ id: "uppercase", kind: "text", source: "file", file: "sharpen/up.ts", why: "outputs were lowercase", parent: "baseline", text: "Answer in UPPERCASE.", dev: 1 });
    expect(r.candidates[0]!.sample).toEqual({ cases: 20, candidate: 1, parent: 0 });
    expect(r.best).toMatchObject({ id: "uppercase", label: "uppercase", baseline: 0, candidate: 1 });
    expect(r.verdict).toBe("proven");
    expect(r.message).toMatch(/\+ uppercase\s+0% -> 100%\s+outputs were lowercase/);
    expect(flat(r.message)).toContain("The text comes from sharpen/up.ts.");
    expect(flat(r.message)).not.toMatch(/No LLM key/); // a person's change needs no key, so nothing is missing
    expect(fs.existsSync(path.join(cwd, ".hone", "sharpen", `${r.id}-best.txt`))).toBe(false); // the file is already the change
  });

  test("changes from files pair up: a config change that only helps on a text, and a text on the best variant", async () => {
    // (1) nothing passes until the text is right; then the config change fixes the other half
    const both = config((id, text, variant) => text.includes("UPPERCASE") && (even(id) || variant === "wide"), { text: true, variants: ["wide"] });
    const wide = both.sharpen!.variants!.wide!;
    delete both.sharpen!.variants;
    const a = await sharpen({
      config: both,
      changes: [
        { name: "wide matching", why: "odd cases are matched too strictly", config: wide, file: "sharpen/wide.ts" },
        { name: "uppercase", why: "outputs were lowercase", text: "Answer in UPPERCASE.", file: "sharpen/up.ts" },
      ],
      hash: "h",
      cwd: tmp(),
      useCache: false,
    });
    expect(a.candidates.map((c) => c.id)).toEqual(["wide matching", "uppercase", "wide matching on uppercase"]);
    expect(a.candidates[0]).toMatchObject({ kind: "variant", source: "file", file: "sharpen/wide.ts", why: "odd cases are matched too strictly", dev: 0 });
    expect(a.candidates[2]).toMatchObject({ kind: "variant", source: "file", parent: "uppercase", variant: "wide matching", text: "Answer in UPPERCASE.", dev: 1 });
    expect(a.verdict).toBe("proven");
    expect(flat(a.message)).toContain("The text comes from sharpen/up.ts.");
    expect(flat(a.message)).toContain('It uses the change "wide matching" from sharpen/wide.ts.');

    // (2) the variant alone is the best single change; the text from the file is then tried on top of it
    const third = (id: string): boolean => Number(id.slice(1)) % 3 === 0;
    const b = await sharpen({
      config: config((id, text, variant) => (third(id) ? text.includes("UPPERCASE") : variant === "wide"), { text: true, variants: ["wide"] }),
      changes: [{ name: "uppercase", why: "outputs were lowercase", text: "Answer in UPPERCASE.", file: "sharpen/up.ts" }],
      hash: "h",
      cwd: tmp(),
      useCache: false,
    });
    expect(b.candidates.map((c) => c.id)).toEqual(["uppercase", "variant wide", "uppercase on variant wide"]);
    expect(b.candidates[2]).toMatchObject({ kind: "text", source: "file", parent: "variant wide", variant: "wide", text: "Answer in UPPERCASE.", dev: 1 });
    expect(b.verdict).toBe("proven");
    expect(flat(b.message)).toContain('It uses the variant "wide" from sharpen.variants.');
  });

  test("with rewrites off the model names the failure modes and proposes nothing: only what a person or an agent wrote is judged", async () => {
    const { chat, prompts } = stubChat();
    const cwd = tmp();
    const base = { hash: "h", cwd, chat, rewrites: false, useCache: false };
    const r = await sharpen({ ...base, config: config((id, text) => text.includes("CAPITALS") && even(id), { text: true }), changes: [{ name: "capitals", why: "outputs were lowercase", text: "Answer in CAPITALS.", file: "sharpen/caps.ts" }] });
    expect(r.candidates.map((c) => `${c.id} ${c.source}`)).toEqual(["capitals file"]); // half the cases still fail, and no rewrite follows
    expect(r.diagnosis[0]!.code).toBe("answers-lowercase"); // the diagnosis is not a proposal
    expect(prompts.every((p) => !p.includes("Current text"))).toBe(true);
    expect(flat(r.message)).toContain("Rewrites by a model were off: only the changes from files and the variants were tried.");
    expect(flat(r.message)).not.toMatch(/No LLM key/);
    // nothing written by anyone: there is nothing to try
    const none = await sharpen({ ...base, cwd: tmp(), config: config(() => false, { text: true }) });
    expect(none.verdict).toBe("nothing to change");
    expect(none.candidates).toEqual([]);
  });

  test("a change that carries a text and a config is one candidate; a text change needs the config to say where a text goes", async () => {
    const cfg = config((_id, text, variant) => text.includes("UPPERCASE") && variant === "wide", { text: true, variants: ["wide"] });
    const wide = cfg.sharpen!.variants!.wide!;
    delete cfg.sharpen!.variants;
    const r = await sharpen({ config: cfg, changes: [{ name: "both at once", why: "they belong together", text: "Answer in UPPERCASE.", config: wide, file: "sharpen/both.ts" }], hash: "h", cwd: tmp(), useCache: false });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ id: "both at once", kind: "both", source: "file", variant: "both at once", text: "Answer in UPPERCASE.", dev: 1 });
    expect(r.verdict).toBe("proven");

    const noSlot = sharpen({ config: config(() => false), changes: [{ name: "uppercase", why: "w", text: "T", file: "sharpen/up.ts" }], hash: "h", cwd: tmp(), useCache: false });
    await expect(noSlot).rejects.toThrow('sharpen/up.ts: change "uppercase" sets a text, but hone.config.ts declares no `sharpen: { text: { seed, apply } }` to put it into');
  });

  test("a model's winning rewrite is also written as a change file that loads like a person's", async () => {
    const cwd = tmp();
    const { chat } = stubChat();
    const r = await sharpen({ config: config((_id, text) => text.includes("UPPERCASE"), { text: true }), hash: "h", cwd, chat, budget: 1, useCache: false });
    const file = path.join(cwd, ".hone", "sharpen", `${r.id}-best.ts`);
    expect(r.message).toContain(`The new text is in .hone/sharpen/${r.id}-best.txt\nAs a change file: .hone/sharpen/${r.id}-best.ts\n`);
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain('import { change } from "hone-eval";');
    const kept = tmp();
    fs.mkdirSync(path.join(kept, "sharpen"));
    fs.writeFileSync(path.join(kept, "sharpen", "kept.ts"), source.replace('"hone-eval"', JSON.stringify(new URL("./change.ts", import.meta.url).pathname)));
    const loaded = await loadChanges(kept);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ name: "rewrite 1", why: "outputs were lowercase", text: "Answer in UPPERCASE.", file: "sharpen/kept.ts" });
  });

  test("a rewrite that only fits the cases it learned from is not adopted", async () => {
    // the system passes a case only when the text names it; the proposer sees dev failures and names exactly those
    const naming = (prompt: string): string => `Answer. ${[...new Set([...prompt.matchAll(/case (c\d+)/g)].map((m) => `[${m[1]}]`))].join("")}`;
    const { chat } = stubChat(naming);
    const r = await sharpen({ config: config((id, text) => text.includes(`[${id}]`), { text: true }), hash: "h", cwd: tmp(), chat, budget: 1, useCache: false });
    expect(r.candidates[0]!.dev).toBeGreaterThan(0);
    expect(r.best).toMatchObject({ id: "rewrite 1", baseline: 0, candidate: 0, diff: 0 });
    expect(r.verdict).toBe("no gain");
    expect(flat(r.message)).toMatch(/Result: NO GAIN\. rewrite 1 looked better on the cases it learned from \(0% -> \d+%\) but not on 10 cases it never saw \(0% -> 0%\)/);
  });

  test("with too few cases to hold any out the verdict stops at promising", async () => {
    const { chat } = stubChat();
    const r = await sharpen({ config: config((_id, text) => text.includes("UPPERCASE"), { text: true, n: 8 }), hash: "h", cwd: tmp(), chat, budget: 1, useCache: false });
    expect(r.split).toMatchObject({ inSample: true, holdout: [] });
    expect(r.best).toMatchObject({ cases: 8, baseline: 0, candidate: 1 });
    expect(r.verdict).toBe("promising");
    expect(r.message).toMatch(/Too few cases to hold any out/);
    expect(flat(r.message)).toMatch(/Result: PROMISING, not proven\./);
  });

  test("five held-out cases that all improve are promising, not proof; six are the least that can be", async () => {
    const { chat } = stubChat();
    const five = await sharpen({ config: config((_id, text) => text.includes("UPPERCASE"), { text: true, n: 15 }), hash: "h", cwd: tmp(), chat, budget: 1, useCache: false });
    expect(five.split.holdout).toHaveLength(5);
    expect(five.best).toMatchObject({ cases: 5, baseline: 0, candidate: 1, needed: 6 });
    expect(five.best!.p).toBeCloseTo(0.0625, 6);
    expect(five.verdict).toBe("promising");
    expect(flat(five.message)).toMatch(/Result: PROMISING, not proven\./);
    expect(flat(five.message)).toMatch(/About 6 held-out cases would settle it\./);
    const six = await sharpen({ config: config((_id, text) => text.includes("UPPERCASE"), { text: true, n: 18 }), hash: "h", cwd: tmp(), chat, budget: 1, useCache: false });
    expect(six.split.holdout).toHaveLength(6);
    expect(six.verdict).toBe("proven");
  });

  test("a held-out set wears out: each new winner it judges has to clear a higher bar; the same one again does not", async () => {
    const run = (cwd: string, n: number, text: string, seed?: number) => sharpen({ config: config((_id, t) => t.includes("UPPERCASE"), { text: true, n }), changes: [{ name: "uppercase", why: "w", text, file: "sharpen/up.ts" }], hash: "h", cwd, seed, useCache: false });
    // 18 cases: six held out, and six out of six gives p = 0.031
    const cwd = tmp();
    const first = await run(cwd, 18, "Answer in UPPERCASE.");
    expect(first.best).toMatchObject({ confirmations: 1, alpha: 0.05 });
    expect(first.verdict).toBe("proven");
    expect(first.message).not.toMatch(/have now judged/);
    // running the same change again is a replication, not another attempt
    const same = await run(cwd, 18, "Answer in UPPERCASE.");
    expect(same.best).toMatchObject({ confirmations: 1, alpha: 0.05 });
    expect(same.verdict).toBe("proven");
    // another change on the same held-out cases is a second question to them
    const second = await run(cwd, 18, "Always answer in UPPERCASE letters.");
    expect(second.best).toMatchObject({ confirmations: 2, alpha: 0.025, needed: 7 });
    expect(second.verdict).toBe("promising"); // the same evidence, but these cases have been asked before
    expect(flat(second.message)).toContain("These 6 held-out cases have now judged 2 different changes, so this one had to reach p < 0.025. New cases restore the bar.");
    expect(flat(second.message)).toMatch(/About 7 held-out cases would settle it\./);
    // another split is another set of cases: its count starts again
    expect((await run(cwd, 18, "Reply in UPPERCASE.", 2)).best).toMatchObject({ confirmations: 1, alpha: 0.05 });
    // with ten held out a second change still clears the higher bar
    const big = tmp();
    await run(big, 30, "Answer in UPPERCASE.");
    const again = await run(big, 30, "Always answer in UPPERCASE letters.");
    expect(again.best).toMatchObject({ confirmations: 2, alpha: 0.025 });
    expect(again.verdict).toBe("proven");
    const counts = JSON.parse(fs.readFileSync(path.join(big, ".hone", "sharpen", "holdout.json"), "utf8")) as Record<string, string[]>;
    expect(Object.values(counts).map((v) => v.length)).toEqual([2]);
  });

  test("gates: a system that does not run, a suite that passes, a config with nothing to change", async () => {
    const boom = config(() => false, { text: true });
    boom.targets = { t: { kind: "fn", fn: () => { throw new Error("boom: connection refused"); } } };
    const broken = await sharpen({ config: boom, hash: "h", cwd: tmp(), chat: stubChat().chat, useCache: false });
    expect(broken.verdict).toBe("cannot measure");
    expect(broken.candidates).toEqual([]);
    expect(flat(broken.message)).toMatch(/Cannot measure: the system failed to run in 20 of 20 trials \(first error: .*boom: connection refused/);

    const fine = await sharpen({ config: config(() => true, { text: true }), hash: "h", cwd: tmp(), chat: stubChat().chat, useCache: false });
    expect(fine.verdict).toBe("nothing to sharpen");
    expect(flat(fine.message)).toMatch(/Nothing to sharpen: all 20 cases pass/);
    // what a newcomer sees right after `hone init`: one example case, and it passes
    const one = await sharpen({ config: config(() => true, { text: true, n: 1 }), hash: "h", cwd: tmp(), useCache: false });
    expect(one.message).toBe("Nothing to sharpen: the one case passes. Add cases that are harder.\n");

    const { chat, prompts } = stubChat();
    const bare = await sharpen({ config: config(() => false), hash: "h", cwd: tmp(), chat, useCache: false });
    expect(bare.verdict).toBe("nothing to change");
    expect(bare.diagnosis[0]).toMatchObject({ code: "answers-lowercase" });
    expect(bare.message).toMatch(/Why it fails:/);
    expect(flat(bare.message)).toMatch(/sharpen: \{ text: \{ seed, apply \} \}/);
    expect(flat(bare.message)).toMatch(/Nothing to change: there is no change to try\. Write one, for example sharpen\/first\.ts:/);
    expect(bare.message).toContain('change("what it does", { why: "which failure it fixes", text: "the new text" });');
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
    expect(flat(budget.message)).toMatch(/Result: NO GAIN\. None of the 2 changes beat what you have\./);
    expect(flat(budget.message)).not.toMatch(/No LLM key/); // no text is declared, so no key is missing

    const cost = await sharpen({ config: dud, hash: "h", cwd: tmp(), maxCost: 0, useCache: false });
    expect(cost.candidates).toEqual([]);
    expect(cost.stopped).toBe("maxCost");
    expect(flat(cost.message)).toMatch(/Result: NO GAIN\. Nothing was tried\./);

    const { chat, prompts } = stubChat();
    const half = config((id, text, variant) => (even(id) ? variant === "wide" : text.includes("UPPERCASE")), { text: true, variants: ["wide"] });
    const until = await sharpen({ config: half, hash: "h", cwd: tmp(), chat, until: 0.3, useCache: false });
    expect(until.candidates.map((c) => c.id)).toEqual(["variant wide"]);
    expect(until.stopped).toBe("until");
    expect(prompts.some((p) => p.includes("Current text"))).toBe(false); // no rewrite was requested
  });
});
