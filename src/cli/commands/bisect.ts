import * as path from "node:path";
import { Cache } from "../../core/cache";
import { loadCases, loadConfig } from "../../core/config";
import { HoneEvents } from "../../core/events";
import { createExecutor } from "../../core/executor";
import { buildPlan } from "../../core/plan";
import { runPlan } from "../../core/scheduler";
import { Store } from "../../core/store";
import { bisect } from "../../correct/bisect";
import { createScorers } from "../../scorers/index";
import { createTargets } from "../../targets/index";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const BISECT_SPEC = {
  flags: ["json"],
  strings: ["good", "bad", "case", "target"],
  numbers: ["trials", "threshold", "max-rounds"],
  repeatable: ["case", "target"],
} as const;

const HELP: Record<string, string> = {
  json: "print the result as JSON",
  good: "a revision where the cases passed",
  bad: "a revision where they fail",
  case: "only these cases (repeatable, globs ok)",
  target: "only these targets (repeatable)",
  trials: "trials per case x target per round (default 5)",
  threshold: "pass rate below which a commit is bad (default: good rate minus 0.1)",
  "max-rounds": "extra measurement rounds for unsure probes (default 3)",
};

export function bisectUsage(): string {
  return `usage: hone bisect --good <rev> --bad <rev> [options]\n\nBinary-search the commit that broke the selected cases, deciding with confidence intervals.\n\n${usageLine(BISECT_SPEC, HELP)}\n`;
}

export async function bisectCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, BISECT_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${bisectUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(bisectUsage());
    return 0;
  }
  const good = args.values.good?.[0];
  const bad = args.values.bad?.[0];
  if (!good || !bad) {
    io.stderr(`--good and --bad are required\n${bisectUsage()}`);
    return 2;
  }
  const store = new Store(await storeRoot(io));
  const cache = new Cache(path.join(await storeRoot(io), "cache"));
  const trials = args.numbers.trials ?? 5;
  const filter = { ...(args.values.case ? { cases: args.values.case } : {}), ...(args.values.target ? { targets: args.values.target } : {}) };
  try {
    const result = await bisect({
      repo: io.cwd,
      good,
      bad,
      threshold: args.numbers.threshold,
      maxRounds: args.numbers["max-rounds"],
      log: (line) => io.stderr(`${line}\n`),
      measure: async (worktree, commit) => {
        // Targets resolve relative paths against the process cwd, so step into the worktree.
        const previous = process.cwd();
        process.chdir(worktree);
        try {
          const { config, hash } = await loadConfig(worktree);
          const cases = await loadCases(config.cases, worktree);
          const targets = createTargets(config.targets);
          const scorers = createScorers(config.scorers);
          const plan = buildPlan({ config: { ...config, trials }, cases, targets: Object.keys(targets), filter });
          const events = new HoneEvents();
          const run = store.createRun({ configHash: hash, targets: Object.keys(targets), caseIds: cases.map((c) => c.id) });
          // No cache: a process target's version does not change with the workspace contents.
          const execute = createExecutor({ targets, scorers, scorerSpecs: config.scorers, cases, cache, store, events, gates: config.gates, runId: run.id, useCache: false });
          const summary = await runPlan(plan, { runId: run.id, execute, events });
          store.finishRun(run.id, { ...(summary as unknown as Record<string, unknown>), bisect: commit });
          for (const t of Object.values(targets)) await t.close?.();
          return { successes: summary.totals.passed, n: summary.totals.trials };
        } finally {
          process.chdir(previous);
        }
      },
    });
    if (args.flags.json) io.stdout(`${JSON.stringify({ schemaVersion: 1, ...result }, null, 2)}\n`);
    else if (result.firstBad) io.stdout(`first bad commit: ${result.firstBad.slice(0, 12)} ${result.firstBadSubject}\n  good rate ${result.goodRate.toFixed(2)}, bad rate ${result.badRate.toFixed(2)}, threshold ${result.threshold.toFixed(2)}, ${result.probes.length} probes\n`);
    else io.stdout(`no regression: ${bad} is not measurably worse than ${good} (good ${result.goodRate.toFixed(2)}, bad ${result.badRate.toFixed(2)}, threshold ${result.threshold.toFixed(2)})\n`);
    return 0;
  } catch (e) {
    io.stderr(`bisect failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  } finally {
    store.close();
  }
}
