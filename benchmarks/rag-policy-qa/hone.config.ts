// Benchmark study: the rag_qa_eval Citation RAG (43 gold questions) evaluated and corrected with hone.
// The original harness's 0/1/2 scoring (eval/scoring.py + eval/judge.py) is ported below so numbers mean the same thing.
import { defineConfig, type HoneConfig, JevClient, type JevQuestion, choice, noul, type ScoreContext } from "../../src/index.ts";

const RAG_REPO = "/Users/minkyu/Documents/rag_qa_eval";
const here = new URL(".", import.meta.url).pathname;
const key = (name: string): string => (Bun.file(`${process.env.HOME}/.config/hone/env`).size ? (require("node:fs").readFileSync(`${process.env.HOME}/.config/hone/env`, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"))?.[1] ?? "") : "");

// Substituted stack (the project's Elice key expired on 2026-10-12): local bge-m3 embeddings via Ollama, Claude Sonnet 5.5 via Anthropic's OpenAI-compatible endpoint.
const BASE_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://rag:rag@localhost:5432/rag_hone",
  EMBED_BASE_URL: "http://localhost:11434/v1",
  EMBED_MODEL: "bge-m3",
  EMBED_DIM: "1024",
  ELICE_API_KEY: key("ANTHROPIC_API_KEY"),
  LLM_BASE_URL: "https://api.anthropic.com/v1",
  LLM_MODEL: "claude-sonnet-5-5",
  LLM_REASONING_EFFORT: "medium",
  RAG_PROMPT: "v1",
  TOP_K: "5",
  RAG_REPO,
};

export const PROMPT_V1 = `당신은 정부 정책 안내 문서를 근거로 답하는 상담원이다.
규칙:
1. 아래 [출처]에 적힌 내용만으로 답한다. 출처에 없는 사실, 수치, 날짜를 추측하거나 보태지 않는다.
2. 사실을 말한 문장 끝마다 근거 출처 번호를 [1], [2]처럼 붙인다.
3. 출처로 답할 수 없으면 다른 말 없이 정확히 [[NO_ANSWER]] 만 출력한다.
4. 한국어로 간결하게 답한다.`;

export function ragTarget(env: Record<string, string>, version: string) {
  return { kind: "python", module: `${here}hone_rag.py`, fn: "handler", python: `${RAG_REPO}/.venv/bin/python`, cwd: RAG_REPO, env: { ...BASE_ENV, ...env }, timeoutMs: 180_000, version };
}

// ---- scoring port -----------------------------------------------------------------------------
const TAU = { value: 0.5, fact: 0.8, mustNot: 0.7, support: 0.5, coverageFull: 0.75 };
const JUDGE_REPEATS = 2;
const TEMPLATES = {
  value: (t: string) => `"answer"가 "question"에 대한 답으로 다음 값을 분명히 말하는가? 값: "${t}". 표기만 다른 같은 값(예: 5천만원 = 5,000만 원)은 같은 값으로 본다. 다른 숫자는 아니다.`,
  fact: (t: string) => `"answer"가 다음 사실을 (표현은 달라도) 담고 있는가? 사실: "${t}"`,
  must_not: (t: string) => `"answer"가 다음과 같은 잘못된 내용을 말하는가? 잘못된 내용: "${t}"`,
  // judge-ko-v2 wording (the project's final judge template)
  support: (t: string) => `id가 "${t}"인 문장만 "question"에 대한 답의 일부로 읽어라. 이 문장의 사실 주장이 "sources"로 완전히 뒷받침되는가? 숫자·날짜·조건이 하나라도 출처와 다르면 아니다. 사실 주장이 없는 문장(인사, 안내 문구 등)은 그렇다로 답한다. 출처에 어떤 내용이 없다거나 확인되지 않는다고 말하는 문장은, "sources"에 그 내용이 실제로 없으면 그렇다, 있으면 아니다로 답한다.`,
  grade: `"answer"가 "question"에 대해 한 응답에 가장 잘 맞는 기준을 고르라.`,
};

interface Gold {
  id: string;
  type: string;
  question: string;
  answer?: string;
  evidence?: { document_id: string; page?: number; quote?: string }[];
  must_include?: { point: string; evidence: { document_id: string; page?: number; quote?: string }[]; facts: string[] }[];
  must_not?: string[];
  scoring?: Record<string, string>;
}
interface RagMeta {
  status: string;
  citations: { document_id: string; page_start: number | null; page_end: number | null; snippet: string }[];
  retrieved: { document_id?: string; page_start?: number | null; page_end?: number | null; text: string }[];
}

export function splitSentences(answer: string): string[] {
  const text = answer.replace(/\s*\[\d+\]/g, "").replaceAll("**", "");
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+\.)\s*/, "").trim();
    for (const s of line.split(/(?<=[.?!])\s+(?=\S)/)) out.push(s.trim());
  }
  return out.filter((s) => s.length >= 6);
}
export function stripExplanation(text: string): string {
  let t = text;
  while (t.endsWith(")")) {
    let depth = 0;
    let start = -1;
    for (let i = t.length - 1; i >= 0; i--) {
      depth += t[i] === ")" ? 1 : t[i] === "(" ? -1 : 0;
      if (depth === 0) {
        start = i;
        break;
      }
    }
    if (start < 0) break;
    t = t.slice(0, start).trimEnd();
  }
  return t;
}
const covers = (chunk: { document_id?: string; page_start?: number | null; page_end?: number | null; text?: string; snippet?: string }, e: { document_id: string; page?: number; quote?: string }): boolean => {
  if (chunk.document_id !== e.document_id) return false;
  if (e.page !== undefined && e.page !== null && chunk.page_start !== null && chunk.page_start !== undefined) return chunk.page_start <= e.page && e.page <= (chunk.page_end ?? chunk.page_start);
  const body = (chunk.text ?? chunk.snippet ?? "").replace(/\s+/g, "");
  return !!e.quote && body.includes(e.quote.replace(/\s+/g, ""));
};
const itemEvidence = (g: Gold) => (g.type === "qual" ? (g.must_include ?? []).flatMap((p) => p.evidence) : (g.evidence ?? []));

let jev: JevClient | undefined;
async function ask(state: unknown, questions: Record<string, JevQuestion>): Promise<{ p: Record<string, number>; probs: Record<string, Record<string, number>>; costUsd: number }> {
  jev ??= new JevClient();
  const p: Record<string, number> = {};
  const probs: Record<string, Record<string, number>> = {};
  let costUsd = 0;
  for (let r = 0; r < JUDGE_REPEATS; r++) {
    const res = await jev.ask(state, questions);
    costUsd += res.costUsd;
    for (const [id, a] of Object.entries(res.answers)) {
      if (a.type === "noul") p[id] = (p[id] ?? 0) + a.noul / JUDGE_REPEATS;
      else if (a.type === "choice") for (const [k, v] of Object.entries(a.probabilities)) (probs[id] ??= {})[k] = (probs[id]![k] ?? 0) + v / JUDGE_REPEATS;
    }
  }
  return { p, probs, costUsd };
}

/** The project's score_record: 2 useful, 1 safe but incomplete, 0 hallucination; value = score/2, pass = score 2. */
export async function gradeRag(ctx: ScoreContext): Promise<{ value: number; pass: boolean; reason: string; evidence: unknown[]; costUsd?: number }> {
  const gold = ctx.case.expected as Gold;
  const meta = ctx.trace.meta as unknown as RagMeta | undefined;
  const answer = typeof ctx.trace.output === "string" ? ctx.trace.output : "";
  if (!meta || ctx.trace.error) return { value: 0, pass: false, reason: `실행 오류: ${ctx.trace.error ?? "no output"}`, evidence: [] };
  const out = { ...meta, answer };
  const refused = out.status === "insufficient_context";
  const evidence = itemEvidence(gold);
  const hit = evidence.length ? out.retrieved.some((c) => evidence.some((e) => covers(c, e))) : null;
  const refusal = (score: number) => ({ value: score / 2, pass: score === 2, reason: `오거절 (${hit === false ? "검색 실패" : "생성 판단"})`, evidence: [{ cause: "오거절", evidence_retrieved: hit }] });
  const sentences = splitSentences(out.answer ?? "");
  const state = { question: gold.question, answer: out.answer, sources: out.retrieved.map((h, i) => ({ ref: i + 1, text: h.text })), sentences: sentences.map((s, i) => ({ id: `s${i}`, text: s })) };
  const questions: Record<string, JevQuestion> = {};
  if (!refused) for (let i = 0; i < sentences.length; i++) questions[`s${i}`] = noul(TEMPLATES.support(`s${i}`));

  if (gold.type === "quant") {
    if (refused) return refusal(1);
    questions.value = noul(TEMPLATES.value(gold.answer ?? ""));
    const j = await ask(state, questions);
    const unsupported = sentences.filter((_, i) => (j.p[`s${i}`] ?? 1) < TAU.support);
    const cited = out.citations.some((c) => evidence.some((e) => covers(c, e)));
    const valueOk = (j.p.value ?? 0) >= TAU.value;
    const detail = { value_p: j.p.value, value_ok: valueOk, cited_evidence: cited, unsupported, evidence_retrieved: hit };
    if (!valueOk || unsupported.length) return { value: 0, pass: false, reason: `환각 (${!valueOk ? "값 불일치" : "근거 없는 문장"})`, evidence: [detail], costUsd: j.costUsd };
    return cited ? { value: 1, pass: true, reason: "정확·인용", evidence: [detail], costUsd: j.costUsd } : { value: 0.5, pass: false, reason: "인용 오류", evidence: [detail], costUsd: j.costUsd };
  }
  if (gold.type === "qual") {
    if (refused) return refusal(1);
    const points = gold.must_include ?? [];
    points.forEach((pt, pi) => pt.facts.forEach((f, fi) => (questions[`f${pi}_${fi}`] = noul(TEMPLATES.fact(f)))));
    (gold.must_not ?? []).forEach((m, mi) => (questions[`m${mi}`] = noul(TEMPLATES.must_not(stripExplanation(m)))));
    const j = await ask(state, questions);
    const unsupported = sentences.filter((_, i) => (j.p[`s${i}`] ?? 1) < TAU.support);
    const facts = points.flatMap((pt, pi) => pt.facts.map((f, fi) => ({ fact: f, p: j.p[`f${pi}_${fi}`] ?? 0, covered: (j.p[`f${pi}_${fi}`] ?? 0) >= TAU.fact, evidence_retrieved: out.retrieved.some((c) => pt.evidence.some((e) => covers(c, e))) })));
    const violations = (gold.must_not ?? []).filter((_, mi) => (j.p[`m${mi}`] ?? 0) >= TAU.mustNot);
    const coverage = facts.filter((f) => f.covered).length / Math.max(1, facts.length);
    const detail = { coverage, facts, must_not_violations: violations, unsupported, evidence_retrieved: hit };
    if (violations.length || unsupported.length) return { value: 0, pass: false, reason: `환각 (${violations.length ? "금지 내용" : "근거 없는 문장"})`, evidence: [detail], costUsd: j.costUsd };
    if (coverage >= TAU.coverageFull) return { value: 1, pass: true, reason: `완전 (커버 ${(coverage * 100).toFixed(0)}%)`, evidence: [detail], costUsd: j.costUsd };
    const missing = facts.filter((f) => !f.covered);
    const notRetrieved = missing.filter((f) => !f.evidence_retrieved).length;
    return { value: 0.5, pass: false, reason: notRetrieved * 2 > missing.length ? `검색 실패 (커버 ${(coverage * 100).toFixed(0)}%)` : `생성 누락 (커버 ${(coverage * 100).toFixed(0)}%)`, evidence: [detail], costUsd: j.costUsd };
  }
  // unanswerable, partial, false_premise, confusion, temporal
  const scoring = gold.scoring ?? {};
  if (refused) return "1" in scoring ? refusal(1) : { value: 1, pass: true, reason: "정당한 거절", evidence: [{ evidence_retrieved: hit }] };
  questions.grade = choice(TEMPLATES.grade, scoring);
  const j = await ask(state, questions);
  const unsupported = sentences.filter((_, i) => (j.p[`s${i}`] ?? 1) < TAU.support);
  const probs = j.probs.grade ?? {};
  let score = Number(Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);
  if (score > 0 && unsupported.length) score = 0;
  const reason = score === 2 ? "기준 충족" : score === 1 ? "오거절" : "환각";
  return { value: score / 2, pass: score === 2, reason, evidence: [{ grade_probabilities: probs, unsupported, evidence_retrieved: hit }], costUsd: j.costUsd };
}

function withEnv(c: HoneConfig, env: Record<string, string>, version: string): HoneConfig {
  return { ...c, targets: { rag: ragTarget(env, version) } };
}

const base = defineConfig({
  targets: { rag: ragTarget({}, "baseline-v1-k5") },
  cases: "cases.json",
  trials: 2,
  concurrency: 1,
  scorers: [{ name: "fn", id: "grade", score: gradeRag }],
});

export default defineConfig({
  ...base,
  ablations: {
    "no-citation-rule": (c) => withEnv(c, { HONE_RAG_PROMPT: PROMPT_V1.replace(/2\. 사실을 말한 문장 끝마다[^\n]*\n/, "") }, "ablate-no-citation"),
  },
  sharpen: {
    // the system prompt, starting from v1
    text: { seed: PROMPT_V1, apply: (c, text) => withEnv(c, { HONE_RAG_PROMPT: text }, `evolved-${Bun.hash(text).toString(16)}`) },
    // what the project's authors found by hand (README 9절): prompt v3 + top_k 30 + medium reasoning was the best
    variants: {
      "prompt-v3": (c) => withEnv(c, { RAG_PROMPT: "v3" }, "v3-k5"),
      k30: (c) => withEnv(c, { TOP_K: "30" }, "v1-k30"),
      "v3-k30": (c) => withEnv(c, { RAG_PROMPT: "v3", TOP_K: "30" }, "v3-k30"),
    },
  },
});
