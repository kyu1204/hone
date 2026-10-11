// Judge calibration: inject silent faults into passing trials, re-score, report detection rates and false alarms.
import type { Trace, Trial } from "../core/types";
import { retrievedDocs } from "../scorers/rag";
import { runScorer, type Scorer } from "../scorers/scorer";
import { wilsonCi } from "../stats/interval";
import type { CalibrationFile } from "../tui/screens/calibrate";

export type Domain = "rag" | "qa" | "agent";
export type Rng = () => number;
/** Returns the faulted copy, or undefined when the fault does not apply to this trial. `pool` is the other passing trials. */
export type Injector = (trial: Trial, rng: Rng, pool: Trial[]) => Trial | undefined;

export function rng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

const text = (t: Trace): string | undefined => (typeof t.output === "string" ? t.output : undefined);
const pick = <T>(xs: T[], r: Rng): T => xs[Math.floor(r() * xs.length)]!;
const CITATION = /\[(c?\d+|[a-z0-9_-]+)\]/gi;
const VERIFY = /test|verify|check|run|bash|pytest|npm|cargo|make/i;
const DONE = /\b(done|complete|completed|fixed|finished|implemented|resolved)\b/i;

function withTrace(trial: Trial, fault: string, patch: Partial<Trace>): Trial {
  return { ...trial, trace: { ...trial.trace, ...patch, meta: { ...trial.trace.meta, injectedFault: fault } } };
}

const FILLERS = ["Additionally, this applies to all residents regardless of age.", "The same rule has been in force since 2019.", "Exemptions are granted automatically on request.", "This was confirmed by the ministry last week."];

export const FAULTS: Record<Domain, Record<string, Injector>> = {
  rag: {
    "unsupported-claim": (t, r) => {
      const out = text(t.trace);
      if (out === undefined || retrievedDocs(t.trace).length === 0) return undefined;
      return withTrace(t, "unsupported-claim", { output: `${out.trimEnd()} ${pick(FILLERS, r)}` });
    },
    "wrong-citation": (t, r) => {
      const out = text(t.trace);
      const ids = retrievedDocs(t.trace).map((d) => d.id);
      const markers = out === undefined ? [] : [...out.matchAll(CITATION)];
      if (!out || markers.length === 0 || ids.length < 2) return undefined;
      const m = pick(markers, r);
      const other = ids.filter((id) => id !== m[1]);
      if (other.length === 0) return undefined;
      const idx = m.index ?? 0;
      return withTrace(t, "wrong-citation", { output: `${out.slice(0, idx)}[${pick(other, r)}]${out.slice(idx + m[0].length)}` });
    },
  },
  qa: {
    "answer-swapped": (t, r, pool) => {
      const others = pool.filter((p) => p.trace.caseId !== t.trace.caseId && text(p.trace) !== undefined && text(p.trace) !== text(t.trace));
      if (others.length === 0) return undefined;
      return withTrace(t, "answer-swapped", { output: pick(others, r).trace.output });
    },
    negated: (t) => {
      const out = text(t.trace);
      if (out === undefined) return undefined;
      const num = out.match(/\d+/);
      if (num) return withTrace(t, "negated", { output: `${out.slice(0, num.index)}${Number(num[0]) + 1}${out.slice(num.index! + num[0].length)}` });
      const verb = out.match(/\b(is|are|was|were|does|did|has|have|can|will)\b/);
      if (!verb) return undefined;
      const at = verb.index! + verb[0].length;
      return withTrace(t, "negated", { output: `${out.slice(0, at)} not${out.slice(at)}` });
    },
  },
  agent: {
    "verification-removed": (t) => {
      const ms = t.trace.messages;
      const lastAssistant = ms.map((m) => m.role).lastIndexOf("assistant");
      let call = -1;
      for (let i = lastAssistant - 1; i >= 0; i--) {
        const m = ms[i]!;
        if (m.role === "assistant" && m.tool_calls?.some((c) => VERIFY.test(c.function.name))) {
          call = i;
          break;
        }
      }
      if (call === -1) return undefined;
      const ids = new Set(ms[call]!.tool_calls!.map((c) => c.id));
      return withTrace(t, "verification-removed", { messages: ms.filter((m, i) => i !== call && !(m.role === "tool" && m.tool_call_id && ids.has(m.tool_call_id))) });
    },
    "tool-result-swapped": (t, r, pool) => {
      const mine = t.trace.messages.map((m, i) => [m, i] as const).filter(([m]) => m.role === "tool");
      const candidates = mine.flatMap(([m, i]) => pool.filter((p) => p.id !== t.id).flatMap((p) => p.trace.messages.filter((o) => o.role === "tool" && o.name === m.name && o.content !== m.content).map((o) => ({ i, content: o.content }))));
      if (candidates.length === 0) return undefined;
      const c = pick(candidates, r);
      return withTrace(t, "tool-result-swapped", { messages: t.trace.messages.map((m, i) => (i === c.i ? { ...m, content: c.content } : m)) });
    },
    "premature-done": (t) => {
      const ms = t.trace.messages;
      const last = ms.map((m) => m.role).lastIndexOf("assistant");
      const at = ms.findIndex((m, i) => i < last && m.role === "assistant" && typeof m.content === "string" && DONE.test(m.content));
      if (at === -1) return undefined;
      const msg = ms[at]!;
      return withTrace(t, "premature-done", { messages: ms.slice(0, at + 1).map((m, i) => (i === at ? { ...m, tool_calls: undefined } : m)), output: msg.content });
    },
  },
};

export function inferDomain(trials: Trial[]): Domain {
  if (trials.some((t) => t.trace.spans.some((s) => s.kind === "retrieval"))) return "rag";
  if (trials.some((t) => t.trace.messages.some((m) => m.tool_calls?.length))) return "agent";
  return "qa";
}

/** Cohen's kappa for two binary raters; 1 when both agree everywhere (including a single category). */
export function cohenKappa(a: boolean[], b: boolean[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let agree = 0;
  let aYes = 0;
  let bYes = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    if (a[i]) aYes++;
    if (b[i]) bYes++;
  }
  const po = agree / n;
  const pe = (aYes / n) * (bYes / n) + (1 - aYes / n) * (1 - bYes / n);
  return pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
}

export interface CalibrateOptions {
  trials: Trial[];
  scorer: Scorer;
  domain: Domain;
  n?: number;
  seed?: number;
  /** trialId -> true when the trial is genuinely good; enables kappa on the clean re-score. */
  labels?: Map<string, boolean>;
}

export async function calibrate(opts: CalibrateOptions): Promise<CalibrationFile> {
  const r = rng(opts.seed ?? 1);
  const passing = opts.trials.filter((t) => t.pass === true).slice(0, opts.n ?? 20);
  const pool = opts.trials.filter((t) => t.pass === true);
  const score = async (t: Trial): Promise<boolean | null> => (await runScorer(opts.scorer, { case: { id: t.trace.caseId, input: t.trace.messages[0]?.content }, trace: t.trace, trial: t.trace.trial })).pass;
  const faults: CalibrationFile["faults"] = [];
  for (const [type, inject] of Object.entries(FAULTS[opts.domain])) {
    let injected = 0;
    let detected = 0;
    for (const t of passing) {
      const faulty = inject(t, r, pool);
      if (!faulty) continue;
      injected++;
      if ((await score(faulty)) === false) detected++;
    }
    const ci = injected > 0 ? wilsonCi(detected, injected) : { mean: 0, lo: 0, hi: 1 };
    faults.push({ type, injected, detected, rate: ci.mean, lo: ci.lo, hi: ci.hi });
  }
  const clean = await Promise.all(passing.map(score));
  const flagged = clean.filter((p) => p === false).length;
  const file: CalibrationFile = { schemaVersion: 1, judge: opts.scorer.name, domain: opts.domain, faults, falseAlarms: { n: passing.length, flagged, rate: passing.length ? flagged / passing.length : 0 } };
  if (opts.labels) {
    const idx = passing.map((t, i) => [t, i] as const).filter(([t]) => opts.labels!.has(t.id));
    if (idx.length) file.kappa = cohenKappa(idx.map(([, i]) => clean[i] !== false), idx.map(([t]) => opts.labels!.get(t.id)!));
  }
  return file;
}
