// Harbor trial and job directories (results.json + agent/trajectory.json), per docs/compat.md section 1.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Case, Score } from "../../core/types";
import { type AtifTrajectory, atifToMessages } from "../atif";
import { type Imported, makeTrial, nowIso } from "./common";

interface TrialResult {
  id?: string;
  task_name?: string;
  trial_name?: string;
  agent_info?: { name?: string; version?: string; model_name?: string };
  agent_result?: { n_input_tokens?: number; n_output_tokens?: number };
  verifier_result?: { rewards?: Record<string, number> | null };
  started_at?: string;
  finished_at?: string;
  exception_info?: { exception_type?: string; exception_message?: string } | null;
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** rewards from results.json, else verifier/reward.json|txt (number or {name: number}). */
export function harborRewards(dir: string, result: TrialResult | undefined): Record<string, number> {
  const r = result?.verifier_result?.rewards;
  if (r && Object.keys(r).length) return r;
  const json = readJson<unknown>(path.join(dir, "verifier", "reward.json"));
  if (typeof json === "number") return { reward: json };
  if (json && typeof json === "object") return Object.fromEntries(Object.entries(json as Record<string, unknown>).filter(([, v]) => typeof v === "number")) as Record<string, number>;
  const txt = path.join(dir, "verifier", "reward.txt");
  if (fs.existsSync(txt)) {
    const n = Number(fs.readFileSync(txt, "utf8").trim());
    if (Number.isFinite(n)) return { reward: n };
  }
  return {};
}

export function importHarborTrial(dir: string, opts: { runId?: string; target?: string; trial?: number } = {}): Imported {
  const result = readJson<TrialResult>(path.join(dir, "results.json"));
  const traj = readJson<AtifTrajectory>(path.join(dir, "agent", "trajectory.json"));
  if (!result && !traj) throw new Error(`${dir}: neither results.json nor agent/trajectory.json found`);
  const parsed = traj ? atifToMessages(traj) : { messages: [], spans: [], meta: {} };
  const caseId = result?.task_name ?? path.basename(path.dirname(path.resolve(dir))) ?? path.basename(dir);
  const targetId = opts.target ?? result?.agent_info?.name ?? (typeof parsed.meta.agent === "string" ? parsed.meta.agent : "harbor");
  const scores: Score[] = Object.entries(harborRewards(dir, result)).map(([scorer, v]) => ({ scorer, value: Math.max(0, Math.min(1, v)), pass: v >= 1 ? true : v <= 0 ? false : null }));
  const startedAt = result?.started_at ?? traj?.steps[0]?.timestamp ?? nowIso();
  const input = parsed.messages.find((m) => m.role === "user")?.content ?? caseId;
  const trial = makeTrial(opts.runId ?? "imported", {
    caseId,
    targetId,
    trial: opts.trial ?? 0,
    startedAt,
    endedAt: result?.finished_at ?? traj?.steps.at(-1)?.timestamp ?? startedAt,
    messages: parsed.messages,
    spans: parsed.spans,
    output: parsed.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? null,
    usage: { inputTokens: result?.agent_result?.n_input_tokens ?? 0, outputTokens: result?.agent_result?.n_output_tokens ?? 0, costUsd: 0 },
    ...(result?.exception_info ? { error: `${result.exception_info.exception_type ?? "error"}: ${result.exception_info.exception_message ?? ""}` } : {}),
    meta: { ...parsed.meta, harbor: { id: result?.id, trial_name: result?.trial_name, dir: path.resolve(dir) }, model: result?.agent_info?.model_name ?? parsed.meta.model },
  }, scores);
  const c: Case = { id: caseId, input, tags: ["harbor"] };
  return { cases: [c], trials: [trial] };
}

/** A trial dir, or a job dir whose subdirectories are trials. */
export function importHarbor(dir: string, opts: { runId?: string; target?: string } = {}): Imported {
  if (fs.existsSync(path.join(dir, "results.json")) || fs.existsSync(path.join(dir, "agent", "trajectory.json"))) return importHarborTrial(dir, opts);
  const subs = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)).filter((p) => fs.statSync(p).isDirectory() && (fs.existsSync(path.join(p, "results.json")) || fs.existsSync(path.join(p, "agent", "trajectory.json")))).sort() : [];
  if (subs.length === 0) throw new Error(`${dir}: no Harbor trial directories found`);
  const cases = new Map<string, Case>();
  const trials = [];
  const perCase = new Map<string, number>();
  for (const sub of subs) {
    const probe = importHarborTrial(sub, { ...opts, trial: 0 });
    const caseId = probe.cases[0]!.id;
    const n = perCase.get(caseId) ?? 0;
    perCase.set(caseId, n + 1);
    const one = n === 0 ? probe : importHarborTrial(sub, { ...opts, trial: n });
    cases.set(caseId, one.cases[0]!);
    trials.push(one.trials[0]!);
  }
  return { cases: [...cases.values()], trials };
}
