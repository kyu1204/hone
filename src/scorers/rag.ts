// RAG scorers: retrieval (recall/precision), citations, faithfulness (Jev per claim), relevance.
import type { ScorerSpec } from "../core/config";
import type { Trace } from "../core/types";
import { JevClient, type JevQuestion, noul, score as scoreQ } from "../providers/jev";
import { registerScorerKind, type Scorer } from "./scorer";

type Spec = ScorerSpec & Record<string, unknown> & { client?: JevClient };

export interface RetrievedDoc {
  id: string;
  text: string;
  score?: number;
}

/** Documents from every retrieval span, ids defaulting to the array index. */
export function retrievedDocs(trace: Trace): RetrievedDoc[] {
  const docs: RetrievedDoc[] = [];
  for (const span of trace.spans) {
    if (span.kind !== "retrieval" || !Array.isArray(span.output)) continue;
    span.output.forEach((d, i) => {
      if (typeof d === "string") docs.push({ id: String(i), text: d });
      else if (typeof d === "object" && d !== null) {
        const o = d as Record<string, unknown>;
        docs.push({ id: String(o.id ?? i), text: String(o.text ?? o.content ?? ""), ...(typeof o.score === "number" ? { score: o.score } : {}) });
      }
    });
  }
  return docs;
}

const outputText = (t: Trace): string => (typeof t.output === "string" ? t.output : JSON.stringify(t.output ?? ""));
const fromCase = (c: unknown, field: string): unknown => field.split(".").reduce<unknown>((acc, k) => (typeof acc === "object" && acc !== null ? (acc as Record<string, unknown>)[k] : undefined), c);

export function splitClaims(text: string, max: number): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15)
    .slice(0, max);
}

function contextRecall(spec: Spec): Scorer {
  return {
    name: String(spec.id ?? "rag.context_recall"),
    score({ case: c, trace }) {
      const docs = retrievedDocs(trace);
      if (docs.length === 0) return { scorer: "", value: 0, pass: false, reason: "no retrieval span in trace" };
      const expected = ((fromCase(c, String(spec.caseField ?? "expected.chunks")) as unknown[] | undefined) ?? []).map(String);
      const got = new Set(docs.map((d) => d.id));
      const hits = expected.filter((e) => got.has(e));
      const value = expected.length === 0 ? 1 : hits.length / expected.length;
      return { scorer: "", value, pass: value === 1, reason: `${hits.length}/${expected.length} expected chunks retrieved`, evidence: [{ missing: expected.filter((e) => !got.has(e)), retrieved: [...got] }] };
    },
  };
}

function contextPrecision(spec: Spec): Scorer {
  return {
    name: String(spec.id ?? "rag.context_precision"),
    score({ case: c, trace }) {
      const docs = retrievedDocs(trace);
      if (docs.length === 0) return { scorer: "", value: 0, pass: false, reason: "no retrieval span in trace" };
      const expected = new Set((((fromCase(c, String(spec.caseField ?? "expected.chunks")) as unknown[] | undefined) ?? []).map(String)));
      const hits = docs.filter((d) => expected.has(d.id));
      const value = hits.length / docs.length;
      return { scorer: "", value, pass: value === 1, reason: `${hits.length}/${docs.length} retrieved chunks are expected`, evidence: [{ extra: docs.filter((d) => !expected.has(d.id)).map((d) => d.id) }] };
    },
  };
}

function citations(spec: Spec): Scorer {
  const re = new RegExp(String(spec.pattern ?? "\\[(c?\\d+|[a-z0-9_-]+)\\]"), "gi");
  return {
    name: String(spec.id ?? "rag.citations"),
    score({ trace }) {
      const ids = new Set(retrievedDocs(trace).map((d) => d.id));
      const markers = [...outputText(trace).matchAll(re)].map((m) => m[1]!);
      if (markers.length === 0) return { scorer: "", value: 0, pass: false, reason: "no citations in output" };
      const unresolved = markers.filter((m) => !ids.has(m));
      const value = (markers.length - unresolved.length) / markers.length;
      return { scorer: "", value, pass: unresolved.length === 0, reason: `${markers.length - unresolved.length}/${markers.length} citations resolve to retrieved chunks`, evidence: [{ unresolved, markers }] };
    },
  };
}

function faithfulness(spec: Spec): Scorer {
  let client = spec.client;
  const batchSize = Number(spec.batchSize ?? 256);
  return {
    name: String(spec.id ?? "rag.faithfulness"),
    cacheKeyExtra: () => ({ model: client?.provider.model ?? "jev" }),
    async score({ trace }) {
      const docs = retrievedDocs(trace);
      if (docs.length === 0) return { scorer: "", value: 0, pass: false, reason: "no retrieval span in trace" };
      const claims = splitClaims(outputText(trace), Number(spec.maxClaims ?? 20));
      if (claims.length === 0) return { scorer: "", value: 0, pass: null, reason: "no claims to check" };
      client ??= new JevClient();
      const context = docs.map((d) => d.text);
      const probs: number[] = [];
      let costUsd = 0;
      for (let i = 0; i < claims.length; i += batchSize) {
        const batch = claims.slice(i, i + batchSize);
        const questions: Record<string, JevQuestion> = {};
        batch.forEach((claim, j) => {
          questions[`k${i + j}`] = noul(`Claim ${i + j}: "${claim}". The claim is fully supported by the context`, { true: "every fact in the claim appears in the context", false: "the claim adds, contradicts or invents information not in the context" });
        });
        const res = await client.ask({ context, claims: batch }, questions);
        costUsd += res.costUsd;
        batch.forEach((_, j) => {
          const a = res.answers[`k${i + j}`];
          probs.push(a?.type === "noul" ? a.noul : 0);
        });
      }
      const value = probs.reduce((a, b) => a + b, 0) / probs.length;
      const min = Math.min(...probs);
      return { scorer: "", value, pass: min >= 0.5, reason: `mean support ${value.toFixed(2)}, weakest claim ${min.toFixed(2)}`, evidence: claims.map((claim, i) => ({ claim, p: probs[i] })), costUsd };
    },
  };
}

const LEVELS = ["irrelevant", "partially relevant", "relevant", "directly answers"];

function answerRelevance(spec: Spec): Scorer {
  let client = spec.client;
  return {
    name: String(spec.id ?? "rag.answer_relevance"),
    cacheKeyExtra: () => ({ model: client?.provider.model ?? "jev" }),
    async score({ case: c, trace }) {
      client ??= new JevClient();
      const res = await client.ask({ question: c.input, answer: trace.output }, { rel: scoreQ("How well does the answer address the question?", LEVELS) });
      const a = res.answers.rel;
      if (a?.type !== "score") return { scorer: "", value: 0, pass: null, reason: "no score answer from judge", costUsd: res.costUsd };
      const value = a.score / (LEVELS.length - 1);
      return { scorer: "", value, pass: value >= 0.5, reason: a.legend?.[Math.round(a.score)] ?? `score ${a.score}`, evidence: [{ score: a.score, probabilities: a.probabilities, confidence: a.confidence }], costUsd: res.costUsd };
    },
  };
}

registerScorerKind("rag.context_recall", (s) => contextRecall(s as Spec));
registerScorerKind("rag.context_precision", (s) => contextPrecision(s as Spec));
registerScorerKind("rag.citations", (s) => citations(s as Spec));
registerScorerKind("rag.faithfulness", (s) => faithfulness(s as Spec));
registerScorerKind("rag.answer_relevance", (s) => answerRelevance(s as Spec));
