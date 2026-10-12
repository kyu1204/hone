// Re-run a target from an edited message prefix and store the result as a forked trial.
import { loadCases, loadConfig, type ScorerSpec } from "../core/config";
import { Store } from "../core/store";
import type { ChatMessage, Score, Trial, TrialFlag } from "../core/types";
import { createScorers, runScorer } from "../scorers/index";
import { createTargets } from "../targets/index";
import { type RunContext, type Target, toTrace } from "../targets/target";

export interface ForkDeps {
  targets: Record<string, Target>;
  scorers: ScorerSpec[];
  caseInputs: Record<string, unknown>;
}

/** Targets, scorer specs and case inputs from hone.config.ts: what every fork caller needs. */
export async function loadForkDeps(cwd: string): Promise<ForkDeps> {
  const { config } = await loadConfig(cwd);
  const cases = await loadCases(config.cases, cwd);
  return { targets: createTargets(config.targets), scorers: config.scorers, caseInputs: Object.fromEntries(cases.map((c) => [c.id, c.input])) };
}

export interface ForkRequest {
  store: Store;
  targets: Record<string, Target>;
  scorers: ScorerSpec[];
  caseInput: unknown;
  original: Trial;
  /** Index of the message being replaced; messages before it are kept verbatim. */
  step: number;
  edited: ChatMessage;
  log?: (line: string) => void;
}

export async function forkTrial(req: ForkRequest): Promise<Trial> {
  const { original } = req;
  const targetId = original.trace.targetId;
  const target = req.targets[targetId];
  if (!target) throw new Error(`target "${targetId}" is not configured; forks need the config loaded`);
  const prefix = [...original.trace.messages.slice(0, req.step), req.edited];
  // editing the first user turn changes the task itself: plain targets get it as their input
  const firstUser = original.trace.messages.findIndex((m) => m.role === "user");
  const caseInput = req.step === firstUser && req.edited.role === "user" && typeof req.edited.content === "string" ? req.edited.content : req.caseInput;
  const siblings = req.store.queryTrials({ runId: original.runId, caseId: original.trace.caseId, targetId });
  const trialIndex = Math.max(-1, ...siblings.map((t) => t.trace.trial)) + 1;
  const ctx: RunContext = { runId: original.runId, caseId: original.trace.caseId, trial: trialIndex, prefix };
  req.log?.(`fork ${original.id} at step ${req.step}: re-running ${targetId}`);
  const startedAt = new Date();
  let out;
  try {
    out = target.resume ? await target.resume(prefix, caseInput, ctx) : await target.run(caseInput, ctx);
  } catch (e) {
    out = { output: null, error: e instanceof Error ? e.message : String(e) };
  }
  const endedAt = new Date();
  const trace = toTrace(out, ctx, targetId, startedAt, endedAt);
  if (trace.messages.length === 0 || trace.messages[0] !== prefix[0]) {
    const startsWithPrefix = prefix.every((m, i) => JSON.stringify(trace.messages[i]) === JSON.stringify(m));
    if (!startsWithPrefix) trace.messages = [...prefix, ...trace.messages];
  }
  // a target that records nothing beyond the prefix still gets its answer as the final assistant turn
  if (trace.error === undefined && trace.messages.length === prefix.length) {
    trace.messages = [...trace.messages, { role: "assistant", content: typeof trace.output === "string" ? trace.output : JSON.stringify(trace.output ?? "") }];
    trace.meta = { ...trace.meta, synthesizedMessages: true };
  }
  trace.meta = { ...trace.meta, forkStep: req.step, forkedFrom: original.id };
  const scoreCtx = { case: { id: original.trace.caseId, input: caseInput }, trace, trial: trialIndex };
  const scores: Score[] = [];
  for (const scorer of createScorers(req.scorers)) scores.push(await runScorer(scorer, scoreCtx));
  const pass = trace.error !== undefined || scores.some((s) => s.pass === false) ? false : scores.some((s) => s.pass === true) ? true : null;
  const flags: TrialFlag[] = [`forked-from:${original.id}`];
  if (trace.error === "timeout") flags.push("timeout");
  const trial: Trial = { id: Store.trialId(original.runId, original.trace.caseId, targetId, trialIndex), runId: original.runId, trace, scores, flags, pass, costUsd: trace.usage.costUsd + scores.reduce((a, s) => a + (s.costUsd ?? 0), 0) };
  req.store.saveTrial(trial);
  req.log?.(`fork stored as ${trial.id}: ${pass === true ? "PASS" : pass === false ? "FAIL" : "UNDECIDED"}`);
  return trial;
}
