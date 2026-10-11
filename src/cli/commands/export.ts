import * as path from "node:path";
import { Store } from "../../core/store";
import { writeRollouts } from "../../io/export/rollouts";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const EXPORT_SPEC = { flags: ["pass-only"], strings: ["run", "out", "reward", "format"], numbers: [], repeatable: [] } as const;
const HELP: Record<string, string> = { run: "run id (default: latest)", out: "output path (default rollouts.jsonl)", "pass-only": "keep only passing trials", reward: "pass (default) | mean-score | <scorer name>", format: "trl (prompt/completion, default) | openai (messages)" };
const KINDS = ["rollouts", "otel", "docent", "junit", "html"];

export function exportUsage(): string {
  return `usage: hone export rollouts [--run id] [--out rollouts.jsonl] [--pass-only] [--reward pass|mean-score|<scorer>] [--format trl|openai]\n\nWrite stored trials as RL-ready JSONL. Other kinds (${KINDS.slice(1).join(", ")}) arrive with T-803.\n\n${usageLine(EXPORT_SPEC, HELP)}\n`;
}

export async function exportCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, EXPORT_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${exportUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(exportUsage());
    return 0;
  }
  const kind = args.positionals[0];
  if (!kind || !KINDS.includes(kind)) {
    io.stderr(`export kind required: ${KINDS.join(", ")}\n${exportUsage()}`);
    return 2;
  }
  if (kind !== "rollouts") {
    io.stderr(`hone export ${kind} is not yet available (T-803)\n`);
    return 2;
  }
  const format = args.values.format?.[0] ?? "trl";
  if (format !== "trl" && format !== "openai") {
    io.stderr(`--format must be trl or openai, got ${format}\n`);
    return 2;
  }
  const store = new Store(await storeRoot(io));
  try {
    const runId = args.values.run?.[0] ?? store.listRuns(1)[0]?.id;
    if (!runId || !store.getRun(runId)) {
      io.stderr(`run ${runId ?? "(none)"} not found\n`);
      return 2;
    }
    const out = path.resolve(io.cwd, args.values.out?.[0] ?? "rollouts.jsonl");
    const n = writeRollouts(store.queryTrials({ runId }), out, { passOnly: args.flags["pass-only"], reward: args.values.reward?.[0], format });
    io.stdout(`wrote ${n} rollouts (${format}) to ${path.relative(io.cwd, out)}\n`);
    return 0;
  } catch (e) {
    io.stderr(`export failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  } finally {
    store.close();
  }
}
