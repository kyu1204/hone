import { ConfigNotFound, loadConfig } from "../../core/config";
import { runAblations } from "../../correct/ablation";
import { ArgError, parseArgs, usageLine } from "../args";
import type { CommandIo } from "./run";

export const ABLATE_SPEC = { flags: ["json", "cache", "quiet"], strings: [], numbers: ["trials", "alpha"], repeatable: [] } as const;
const HELP: Record<string, string> = { json: "print the report as JSON", cache: "use the cache (default on)", quiet: "no progress on stderr", trials: "trials per cell for every run", alpha: "significance level (default 0.05)" };

export function ablateUsage(): string {
  return `usage: hone ablate [name]... [options]\n\nRun the baseline and each named ablation from hone.config.ts, then compare paired.\n\n${usageLine(ABLATE_SPEC, HELP)}\n`;
}

export async function ablateCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, ABLATE_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${ablateUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(ablateUsage());
    return 0;
  }
  let loaded: Awaited<ReturnType<typeof loadConfig>>;
  try {
    loaded = await loadConfig(io.cwd);
  } catch (e) {
    io.stderr(`${e instanceof ConfigNotFound ? e.message : `config error: ${e instanceof Error ? e.message : String(e)}`}\n`);
    return 2;
  }
  try {
    const result = await runAblations({ config: loaded.config, hash: loaded.hash, cwd: io.cwd, names: args.positionals, trials: args.numbers.trials, alpha: args.numbers.alpha, useCache: args.flags.cache !== false, log: args.flags.quiet ? undefined : (s) => io.stderr(s) });
    if (args.flags.json) {
      io.stdout(`${JSON.stringify({ schemaVersion: 1, ...result }, null, 2)}\n`);
      return 0;
    }
    const lines = [`baseline pass@1 ${result.baseline.passAt1.toFixed(2)} cost $${result.baseline.costUsd.toFixed(4)} (run ${result.baseline.runId})`, ""];
    const width = Math.max(10, ...result.ablations.map((a) => a.name.length)) + 2;
    lines.push(`${"ablation".padEnd(width)}pass@1  delta    CI95            p        cost delta  verdict`);
    for (const a of result.ablations) {
      lines.push(`${a.name.padEnd(width)}${a.passAt1.toFixed(2).padEnd(8)}${(a.delta >= 0 ? "+" : "") + a.delta.toFixed(2)}    [${a.lo.toFixed(2)}, ${a.hi.toFixed(2)}]   ${a.p.toExponential(1).padEnd(9)}${(a.costDelta >= 0 ? "+" : "-")}$${Math.abs(a.costDelta).toFixed(4)}   ${a.verdict}`);
    }
    lines.push("", "delta = ablation minus baseline; a negative delta with a small p means the removed component was helping.");
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}
