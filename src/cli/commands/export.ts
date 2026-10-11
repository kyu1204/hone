import * as path from "node:path";
import * as fs from "node:fs";
import { Store } from "../../core/store";
import { tracesToDocent } from "../../io/export/docent";
import { renderReport } from "../../io/export/html";
import { junitXml } from "../../io/export/junit";
import { tracesToOtel } from "../../io/export/otel";
import { writeRollouts } from "../../io/export/rollouts";
import { VERSION } from "../../index";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const EXPORT_SPEC = { flags: ["pass-only"], strings: ["run", "out", "reward", "format"], numbers: [], repeatable: [] } as const;
const HELP: Record<string, string> = { run: "run id (default: latest)", out: "output path (default per kind: rollouts.jsonl, otel.json, docent.json, junit.xml, report.html)", "pass-only": "keep only passing trials (rollouts)", reward: "rollouts: pass (default) | mean-score | <scorer name>", format: "rollouts: trl (prompt/completion, default) | openai (messages)" };
const KINDS = ["rollouts", "otel", "docent", "junit", "html"] as const;
const DEFAULT_OUT: Record<(typeof KINDS)[number], string> = { rollouts: "rollouts.jsonl", otel: "otel.json", docent: "docent.json", junit: "junit.xml", html: "report.html" };

export function exportUsage(): string {
  return `usage: hone export rollouts [--run id] [--out rollouts.jsonl] [--pass-only] [--reward pass|mean-score|<scorer>] [--format trl|openai]\n       hone export otel|docent|junit|html [--run id] [--out path]\n\nWrite a run's trials as RL-ready JSONL, OpenTelemetry GenAI spans (OTLP JSON), Docent AgentRuns, JUnit XML, or a self-contained HTML report.\n\n${usageLine(EXPORT_SPEC, HELP)}\n`;
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
  if (!kind || !(KINDS as readonly string[]).includes(kind)) {
    io.stderr(`export kind required: ${KINDS.join(", ")}\n${exportUsage()}`);
    return 2;
  }
  const k = kind as (typeof KINDS)[number];
  const format = args.values.format?.[0] ?? "trl";
  if (k === "rollouts" && format !== "trl" && format !== "openai") {
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
    const out = path.resolve(io.cwd, args.values.out?.[0] ?? DEFAULT_OUT[k]);
    const trials = store.queryTrials({ runId });
    if (k === "rollouts") {
      const n = writeRollouts(trials, out, { passOnly: args.flags["pass-only"], reward: args.values.reward?.[0], format: format as "trl" | "openai" });
      io.stdout(`wrote ${n} rollouts (${format}) to ${path.relative(io.cwd, out)}\n`);
      return 0;
    }
    const run = store.getRun(runId);
    const text = k === "otel" ? `${JSON.stringify(tracesToOtel(trials, { version: VERSION }), null, 2)}\n` : k === "docent" ? `${JSON.stringify(tracesToDocent(trials), null, 2)}\n` : k === "junit" ? junitXml(trials, { suite: `hone ${runId}` }) : renderReport(runId, trials, run?.summary);
    fs.writeFileSync(out, text);
    io.stdout(`wrote ${trials.length} trials as ${k} to ${path.relative(io.cwd, out)}\n`);
    return 0;
  } catch (e) {
    io.stderr(`export failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  } finally {
    store.close();
  }
}
