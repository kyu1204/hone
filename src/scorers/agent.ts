// What an agent must have done, said in the case: `expected.calls`, `never`, `order`, `args`, `says`, `never_says` and
// `judge` (a rule in words). One scorer reads them all, so a case for an agent needs no scorer written by hand.
import type { ScorerSpec } from "../core/config";
import type { Trace } from "../core/types";
import { LlmConfigError, type LlmProvider } from "../providers/llm";
import { renderPrefix } from "../targets/process";
import { askJson } from "./judge/llm";
import { registerScorerKind, type Scorer } from "./scorer";

export interface AgentExpected {
  calls?: string[];
  never?: string[];
  order?: string[];
  args?: Record<string, Record<string, unknown>>;
  says?: string[];
  never_says?: string[];
  judge?: string | string[];
}
export const AGENT_KEYS = ["calls", "never", "order", "args", "says", "never_says", "judge"] as const;

interface AgentSpec extends ScorerSpec {
  provider?: LlmProvider;
  /** `false`: rules in words are not sent to a model and their trials stay undecided. */
  model?: boolean;
}

const asText = (x: unknown): string => (typeof x === "string" ? x : JSON.stringify(x ?? ""));
const norm = (x: unknown): string => asText(x).trim().toLowerCase();
const parsed = (raw: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw || "{}") as unknown;
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** The tool calls in the order they were made: from the messages, or from tool spans when a target records only those. */
function callsOf(trace: Trace): { name: string; args: Record<string, unknown> }[] {
  const fromMessages = trace.messages.flatMap((m) => m.tool_calls ?? []).map((c) => ({ name: c.function.name, args: parsed(c.function.arguments) }));
  if (fromMessages.length) return fromMessages;
  return trace.spans.filter((s) => s.kind === "tool").map((s) => ({ name: s.name, args: (typeof s.input === "object" && s.input !== null ? s.input : {}) as Record<string, unknown> }));
}

/** Every written expectation the conversation breaks, each named once. */
function broken(e: AgentExpected, trace: Trace): string[] {
  const calls = callsOf(trace);
  const used = calls.map((c) => c.name);
  const answer = asText(trace.output).toLowerCase();
  const out: string[] = [];
  for (const t of e.calls ?? []) if (!used.includes(t)) out.push(`did not call ${t}`);
  for (const t of e.never ?? []) if (used.includes(t)) out.push(`called ${t}, which this case does not allow`);
  const order = e.order ?? [];
  for (const t of order) if (!used.includes(t)) out.push(`did not call ${t}`);
  for (let i = 1; i < order.length; i++) {
    const [before, after] = [used.indexOf(order[i - 1]!), used.indexOf(order[i]!)];
    if (before >= 0 && after >= 0 && after < before) out.push(`called ${order[i]} before ${order[i - 1]}`);
  }
  for (const [tool, want] of Object.entries(e.args ?? {})) {
    const made = calls.filter((c) => c.name === tool);
    if (!made.length) {
      out.push(`did not call ${tool}`);
      continue;
    }
    for (const [key, value] of Object.entries(want)) {
      const got = made.map((c) => norm(c.args[key]));
      if (!got.includes(norm(value))) out.push(`${tool} was called with ${key} "${got.join('", "')}"; this case needs "${norm(value)}"`);
    }
  }
  for (const s of e.says ?? []) if (!answer.includes(s.toLowerCase())) out.push(`the answer does not contain "${s}"`);
  for (const s of e.never_says ?? []) if (answer.includes(s.toLowerCase())) out.push(`the answer contains "${s}", which it must not`);
  return [...new Set(out)];
}

const SYSTEM = 'You check one rule against a conversation between a user and an AI agent, including the tools the agent called and what they returned. Reply with JSON only: {"verdict":"pass"|"fail"|"unknown","reason":"<one sentence>"}. Answer "unknown" when the conversation does not show enough to decide.';

async function ask(rule: string, trace: Trace, spec: AgentSpec): Promise<{ pass: boolean | null; reason: string; costUsd: number }> {
  if (spec.model === false) return { pass: null, reason: `no model to judge "${rule}"`, costUsd: 0 };
  try {
    const { json, costUsd } = await askJson(spec, [{ role: "user", content: `Rule: ${rule}\n\nConversation:\n${renderPrefix(trace.messages)}` }], SYSTEM);
    const r = (json ?? {}) as { verdict?: string; reason?: string };
    const verdict = String(r.verdict ?? "unknown").toLowerCase();
    return { pass: verdict === "pass" ? true : verdict === "fail" ? false : null, reason: String(r.reason ?? verdict), costUsd };
  } catch (e) {
    return { pass: null, reason: e instanceof LlmConfigError ? `no model to judge "${rule}" (no LLM key)` : `could not judge "${rule}": ${e instanceof Error ? e.message : String(e)}`, costUsd: 0 };
  }
}

export function agentScorer(spec: AgentSpec): Scorer {
  return {
    name: String(spec.id ?? "agent"),
    cacheKeyExtra: () => ({ model: spec.model === false ? "none" : (spec.provider?.model ?? "default") }),
    async score({ case: c, trace }) {
      const e = c.expected as AgentExpected | undefined;
      if (typeof e !== "object" || e === null || !AGENT_KEYS.some((k) => k in e)) return { scorer: "", value: 1, pass: null, reason: "this case says nothing about the conversation" };
      const plain = broken(e, trace);
      // ponytail: a written expectation that already failed is reason enough; the model is not asked about the rules in words
      if (plain.length) return { scorer: "", value: 0, pass: false, reason: plain.join("; ") };
      const rules = [e.judge ?? []].flat();
      let costUsd = 0;
      const failed: string[] = [];
      const undecided: string[] = [];
      for (const rule of rules) {
        const r = await ask(rule, trace, spec);
        costUsd += r.costUsd;
        if (r.pass === false) failed.push(`${rule}: ${r.reason}`);
        else if (r.pass === null) undecided.push(r.reason);
      }
      if (failed.length) return { scorer: "", value: 0, pass: false, reason: failed.join("; "), costUsd };
      if (undecided.length) return { scorer: "", value: 0, pass: null, reason: undecided.join("; "), costUsd };
      return { scorer: "", value: 1, pass: true, reason: "every expectation holds", costUsd };
    },
  };
}

registerScorerKind("agent", (spec) => agentScorer(spec as AgentSpec));
