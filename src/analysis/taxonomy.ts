// Failure taxonomy: induce named codes from clusters with an LLM, merge with the saved taxonomy, classify trials with Jev.
import * as fs from "node:fs";
import * as path from "node:path";
import type { FailureCode, Trial } from "../core/types";
import type { JevQuestion, JevResult } from "../providers/jev";
import { choice, noul } from "../providers/jev";
import type { ChatRequest } from "../providers/llm";
import type { FailureCluster } from "./cluster";
import { summarise } from "./cluster";

export type ChatFn = (req: ChatRequest) => Promise<{ text: string }>;
export type JevAsk = { ask(state: unknown, questions: Record<string, JevQuestion>): Promise<JevResult> };

export interface TaxonomyFile {
  schemaVersion: 1;
  updatedAt: string;
  codes: FailureCode[];
}

const taxonomyPath = (root: string): string => path.join(root, "taxonomy.json");

export function readTaxonomy(root: string): TaxonomyFile | undefined {
  try {
    return JSON.parse(fs.readFileSync(taxonomyPath(root), "utf8")) as TaxonomyFile;
  } catch {
    return undefined;
  }
}

export function writeTaxonomy(root: string, codes: FailureCode[]): void {
  fs.mkdirSync(root, { recursive: true });
  const file: TaxonomyFile = { schemaVersion: 1, updatedAt: new Date().toISOString(), codes };
  fs.writeFileSync(taxonomyPath(root), `${JSON.stringify(file, null, 2)}\n`);
}

const kebab = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Parse the model's JSON (bare or fenced); undefined when it is not a code object. */
export function parseCodeJson(text: string): FailureCode | undefined {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  try {
    const o = JSON.parse(m[0]) as Partial<FailureCode>;
    if (typeof o.code !== "string" || typeof o.definition !== "string") return undefined;
    const axis = o.axis === "role" || o.axis === "domain" ? o.axis : "system";
    return { code: kebab(o.code), axis, definition: o.definition, evidencePatterns: Array.isArray(o.evidencePatterns) ? o.evidencePatterns.filter((p): p is string => typeof p === "string") : [] };
  } catch {
    return undefined;
  }
}

const INDUCE_SYSTEM = `You name failure modes of an AI system from samples of its failed runs. Reply with one JSON object only:
{"code": "<kebab-case, 2-4 words>", "axis": "system" | "role" | "domain", "definition": "<one sentence a reviewer can apply>", "evidencePatterns": ["<short strings that appear in traces of this failure>"]}
axis: system = the agent or pipeline itself (loops, timeouts, tool misuse); role = behaviour against the task contract (tampering, skipping verification, claiming completion); domain = wrong content (hallucinated facts, bad citations, wrong math).`;

export interface InduceOptions {
  chat: ChatFn;
  existing?: FailureCode[];
  jev?: JevAsk;
  sameThreshold?: number;
}

/** One chat call per cluster; codes matching an existing one (same code, or Jev says same failure) keep the existing entry. */
export async function induceTaxonomy(clusters: FailureCluster[], opts: InduceOptions): Promise<FailureCode[]> {
  const existing = opts.existing ?? [];
  const out: FailureCode[] = [];
  for (const c of clusters) {
    const samples = c.summaries.slice(0, 6).map((s, i) => `--- sample ${i + 1} ---\n${s}`);
    const res = await opts.chat({ system: INDUCE_SYSTEM, json: true, temperature: 0, messages: [{ role: "user", content: `Top terms: ${c.topTerms.join(", ")}\n\n${samples.join("\n\n")}` }] });
    const parsed = parseCodeJson(res.text) ?? { code: c.id, axis: "system" as const, definition: c.topTerms.join(", "), evidencePatterns: c.topTerms };
    const merged = await matchExisting(parsed, existing, opts);
    if (merged && !out.some((o) => o.code === merged.code)) out.push(merged);
    else if (!merged && !out.some((o) => o.code === parsed.code)) out.push(parsed);
  }
  return out;
}

async function matchExisting(code: FailureCode, existing: FailureCode[], opts: InduceOptions): Promise<FailureCode | undefined> {
  const same = existing.find((e) => e.code === code.code);
  if (same) return same;
  if (!opts.jev || existing.length === 0) return undefined;
  const questions = Object.fromEntries(existing.map((e) => [e.code, noul(`Does the candidate describe the same failure mode as the existing code "${e.code}"?`, { true: "Same failure mode, one would be a duplicate of the other.", false: "Different failure modes." })]));
  const res = await opts.jev.ask({ candidate: { code: code.code, definition: code.definition }, existing: existing.map((e) => ({ code: e.code, definition: e.definition })) }, questions);
  let best: { code: string; p: number } | undefined;
  for (const [k, a] of Object.entries(res.answers)) if (a.type === "noul" && (!best || a.noul > best.p)) best = { code: k, p: a.noul };
  return best && best.p >= (opts.sameThreshold ?? 0.8) ? existing.find((e) => e.code === best!.code) : undefined;
}

export interface Classification {
  code: string;
  confidence: number;
}

/** One Jev choice per trial over the codes plus `other`. */
export async function classify(trials: Trial[], codes: FailureCode[], opts: { jev: JevAsk }): Promise<Map<string, Classification>> {
  if (codes.length === 0) return new Map();
  const options: Record<string, string> = Object.fromEntries(codes.map((c) => [c.code, c.definition]));
  options.other = "None of the listed failure modes fits.";
  const question = choice("Which failure mode best explains this failed run?", options);
  const results = await Promise.all(
    trials.map(async (t) => {
      const last = t.trace.messages.slice(-6);
      const res = await opts.jev.ask({ trialId: t.id, summary: summarise(t), lastMessages: last }, { code: question });
      const a = res.answers.code;
      return [t.id, a?.type === "choice" ? { code: a.choice, confidence: a.confidence } : { code: "other", confidence: 0 }] as const;
    }),
  );
  return new Map(results);
}
