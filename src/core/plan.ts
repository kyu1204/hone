import type { HoneConfig } from "./config";
import type { Case } from "./types";

export interface PlanCell {
  caseId: string;
  targetId: string;
}

export interface Plan {
  cells: PlanCell[];
  trials: number;
  adaptive?: { ciWidth: number; maxTrials: number; minTrials?: number };
  concurrency: number;
}

export interface PlanFilter {
  cases?: string[];
  targets?: string[];
  tags?: string[];
}

const matches = (id: string, patterns: string[] | undefined): boolean => !patterns?.length || patterns.some((p) => p === id || new Bun.Glob(p).match(id));

export function buildPlan({ config, cases, targets, filter = {} }: { config: HoneConfig; cases: Case[]; targets: string[]; filter?: PlanFilter }): Plan {
  const selectedTargets = targets.filter((t) => matches(t, filter.targets));
  if (selectedTargets.length === 0) throw new Error(`no targets matched ${filter.targets?.join(", ") ?? ""} (known: ${targets.join(", ")})`);
  const selectedCases = cases.filter((c) => matches(c.id, filter.cases) && (!filter.tags?.length || (c.tags ?? []).some((t) => filter.tags!.includes(t))));
  if (selectedCases.length === 0) throw new Error(`no cases matched ${[...(filter.cases ?? []), ...(filter.tags ?? [])].join(", ")} (${cases.length} loaded)`);
  const cells: PlanCell[] = [];
  for (const c of selectedCases) for (const t of selectedTargets) cells.push({ caseId: c.id, targetId: t });
  const plan: Plan = { cells, trials: config.trials ?? 3, concurrency: config.concurrency ?? 4 };
  if (config.adaptive) plan.adaptive = { ...config.adaptive };
  return plan;
}
