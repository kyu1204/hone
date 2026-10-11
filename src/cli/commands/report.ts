import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "../../core/store";
import { renderReport } from "../../io/export/html";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const REPORT_SPEC = { flags: [], strings: ["run", "out"], numbers: [], repeatable: [] } as const;
const HELP: Record<string, string> = { run: "run id (default: latest)", out: "output path (default report.html)" };

export function reportUsage(): string {
  return `usage: hone report [--run id] [--out report.html]\n\nWrite a self-contained HTML report for a run (same as hone export html).\n\n${usageLine(REPORT_SPEC, HELP)}\n`;
}


export async function reportCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, REPORT_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${reportUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(reportUsage());
    return 0;
  }
  const store = new Store(await storeRoot(io));
  try {
    const runId = args.values.run?.[0] ?? store.listRuns(1)[0]?.id;
    if (!runId) {
      io.stderr("no runs found; run `hone run` first\n");
      return 2;
    }
    const trials = store.queryTrials({ runId });
    const run = store.getRun(runId);
    const out = path.resolve(io.cwd, args.values.out?.[0] ?? "report.html");
    fs.writeFileSync(out, renderReport(runId, trials, run?.summary));
    io.stdout(`wrote ${out} (${trials.length} trials)\n`);
    return 0;
  } finally {
    store.close();
  }
}
