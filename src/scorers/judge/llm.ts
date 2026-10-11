// Generative judges: free-form rubrics with explanations, and pairwise comparison with order swap.
import type { ScorerSpec } from "../../core/config";
import type { ChatMessage } from "../../core/types";
import { chat, type LlmProvider } from "../../providers/llm";
import { registerScorerKind, type ScoreContext, type Scorer } from "../scorer";

interface LlmSpec extends ScorerSpec {
  rubric?: string;
  provider?: LlmProvider;
  temperature?: number;
  state?: "output" | "messages";
}

const GUIDANCE = [
  "Grade the outcome, not whether a particular sequence of steps was followed.",
  "Give partial credit where part of the rubric is met.",
  "Judge one dimension at a time and explain each score in one sentence.",
  'If you cannot decide from the evidence, answer with verdict "unknown" instead of guessing.',
].join(" ");

const text = (x: unknown): string => (typeof x === "string" ? x : JSON.stringify(x ?? "", null, 1));

function extractJson(s: string): unknown {
  const stripped = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

async function askJson(spec: LlmSpec, messages: ChatMessage[], system: string): Promise<{ json: unknown; costUsd: number; raw: string }> {
  let costUsd = 0;
  let res = await chat({ system, messages, json: true, temperature: spec.temperature ?? 0 }, { provider: spec.provider });
  costUsd += res.usage.costUsd;
  let json = extractJson(res.text);
  if (json === undefined) {
    res = await chat(
      { system, messages: [...messages, { role: "assistant", content: res.text }, { role: "user", content: "That was not valid JSON. Reply again with only the JSON object, no prose." }], json: true, temperature: 0 },
      { provider: spec.provider },
    );
    costUsd += res.usage.costUsd;
    json = extractJson(res.text);
  }
  return { json, costUsd, raw: res.text };
}

function evidenceOf(ctx: ScoreContext, mode: "output" | "messages" | undefined): string {
  if (mode === "messages") return text(ctx.trace.messages);
  return `Input:\n${text(ctx.case.input)}\n\nExpected (may be empty):\n${text(ctx.case.expected)}\n\nOutput:\n${text(ctx.trace.output)}`;
}

interface RubricReply {
  dimensions?: Record<string, { score?: number; reason?: string }>;
  overall?: number;
  reason?: string;
  verdict?: string;
}

function llmRubric(spec: LlmSpec & { dimensions?: string[]; scale?: number }): Scorer {
  const scale = spec.scale ?? 5;
  return {
    name: String(spec.id ?? "llm.rubric"),
    cacheKeyExtra: () => ({ model: spec.provider?.model ?? "default", dims: spec.dimensions ?? [], scale }),
    async score(ctx) {
      const rubric = spec.rubric ?? ctx.case.rubric ?? "The output correctly and completely answers the input.";
      const dims = spec.dimensions?.length ? spec.dimensions : ["overall"];
      const system = `You are a strict evaluator. ${GUIDANCE} Scores are integers from 0 to ${scale}. Reply with JSON only: {"dimensions":{${dims.map((d) => `"${d}":{"score":0,"reason":""}`).join(",")}},"overall":0,"reason":"","verdict":"pass"|"fail"|"unknown"}`;
      const user = `Rubric:\n${rubric}\n\nDimensions: ${dims.join(", ")}\n\n${evidenceOf(ctx, spec.state)}`;
      const { json, costUsd, raw } = await askJson(spec, [{ role: "user", content: user }], system);
      if (typeof json !== "object" || json === null) return { scorer: "", value: 0, pass: null, reason: `judge did not return JSON: ${raw.slice(0, 120)}`, costUsd };
      const r = json as RubricReply;
      const overall = typeof r.overall === "number" ? r.overall : Object.values(r.dimensions ?? {}).reduce((a, d) => a + (d.score ?? 0), 0) / Math.max(1, Object.keys(r.dimensions ?? {}).length);
      const verdict = String(r.verdict ?? "unknown").toLowerCase();
      const pass = verdict === "pass" ? true : verdict === "fail" ? false : null;
      const evidence = Object.entries(r.dimensions ?? {}).map(([dimension, d]) => ({ dimension, score: d.score ?? 0, reason: d.reason ?? "" }));
      return { scorer: "", value: overall / scale, pass, reason: r.reason ?? verdict, evidence, costUsd };
    },
  };
}

function llmPairwise(spec: LlmSpec & { swap?: boolean }): Scorer {
  const swap = spec.swap !== false;
  return {
    name: String(spec.id ?? "llm.pairwise"),
    cacheKeyExtra: () => ({ model: spec.provider?.model ?? "default", swap }),
    async score(ctx) {
      if (!ctx.runOther) return { scorer: "", value: 0, pass: null, reason: "pairwise needs ctx.runOther (provided by compare)" };
      const other = await ctx.runOther();
      const rubric = spec.rubric ?? ctx.case.rubric ?? "Which answer better addresses the input?";
      const system = `You are a strict evaluator comparing two candidate answers. ${GUIDANCE} Reply with JSON only: {"winner":"A"|"B"|"tie","reason":""}`;
      const ask = async (a: unknown, b: unknown) => {
        const user = `Rubric:\n${rubric}\n\nInput:\n${text(ctx.case.input)}\n\nCandidate A:\n${text(a)}\n\nCandidate B:\n${text(b)}`;
        const { json, costUsd } = await askJson(spec, [{ role: "user", content: user }], system);
        const w = String((json as { winner?: string } | undefined)?.winner ?? "tie").toUpperCase();
        return { winner: w === "A" || w === "B" ? w : "TIE", reason: String((json as { reason?: string } | undefined)?.reason ?? ""), costUsd };
      };
      const first = await ask(ctx.trace.output, other.output);
      let costUsd = first.costUsd;
      let outcome: "win" | "loss" | "tie" = first.winner === "A" ? "win" : first.winner === "B" ? "loss" : "tie";
      let reason = first.reason;
      if (swap) {
        const second = await ask(other.output, ctx.trace.output);
        costUsd += second.costUsd;
        const swapped: "win" | "loss" | "tie" = second.winner === "B" ? "win" : second.winner === "A" ? "loss" : "tie";
        if (swapped !== outcome) {
          outcome = "tie";
          reason = `judge changed its mind when the order was swapped (${first.winner} then ${second.winner}); counted as a tie`;
        }
      }
      const value = outcome === "win" ? 1 : outcome === "tie" ? 0.5 : 0;
      return { scorer: "", value, pass: outcome === "tie" ? null : outcome === "win", reason, evidence: [{ outcome, other: other.output }], costUsd };
    },
  };
}

registerScorerKind("llm.rubric", (s) => llmRubric(s as never));
registerScorerKind("llm.pairwise", (s) => llmPairwise(s as never));
