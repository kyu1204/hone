import * as path from "node:path";
import { ConfigNotFound, loadConfig } from "../../core/config";
import { optimize, type OptimizeResult } from "../../correct/optimize";
import { ArgError, parseArgs, usageLine } from "../args";
import type { CommandIo } from "./run";

export const OPTIMIZE_SPEC = { flags: ["json", "no-cache"], strings: [], numbers: ["budget", "batch", "confidence", "alpha", "min-per-arm", "seed"], repeatable: [] } as const;
const HELP: Record<string, string> = { budget: "total trials to spend (default 60)", batch: "trials per allocation round (default 10)", confidence: "stop when P(best) reaches this (default 0.95)", alpha: "significance for the final paired verdict (default 0.05)", "min-per-arm": "trials every arm gets before stopping early (default 3)", seed: "Thompson sampling seed", "no-cache": "re-run targets instead of using cached outputs", json: "print the result as JSON" };

export function optimizeUsage(): string {
  return `usage: hone optimize [--budget 60] [--batch 10] [--confidence 0.95] [--alpha 0.05] [--min-per-arm 3] [--seed n] [--no-cache] [--json]\n\nAllocate trials across the variants in config.sharpen.variants by Thompson sampling, then decide with a paired test.\n\n${usageLine(OPTIMIZE_SPEC, HELP)}\n`;
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

export function renderOptimize(r: OptimizeResult): string {
  const lines = ["  arm          trials   pass    95% CI        P(best)   cost"];
  for (const a of [...r.arms].sort((x, y) => y.probBest - x.probBest)) lines.push(`  ${a.id.padEnd(12)} ${String(a.trials).padStart(6)}   ${pct(a.trials ? a.passed / a.trials : 0).padStart(4)}   [${pct(a.lo).padStart(4)}, ${pct(a.hi).padStart(4)}]  ${pct(a.probBest).padStart(6)}   $${a.costUsd.toFixed(4)}`);
  lines.push("", `spent ${r.spent} trials (stopped: ${r.stopped})${r.verified ? ` + ${r.verified} verification trials` : ""}`, `verdict: ${r.verdict}`);
  return `${lines.join("\n")}\n`;
}

export async function optimizeCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, OPTIMIZE_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${optimizeUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(optimizeUsage());
    return 0;
  }
  let loaded;
  try {
    loaded = await loadConfig(io.cwd);
  } catch (e) {
    io.stderr(`${e instanceof ConfigNotFound ? e.message : `config error: ${e instanceof Error ? e.message : String(e)}`}\n`);
    return 2;
  }
  if (!loaded.config.sharpen?.variants || Object.keys(loaded.config.sharpen.variants).length === 0) {
    io.stderr("config declares no variants; add `sharpen: { variants: { name: (config) => config } }` to hone.config.ts\n");
    return 2;
  }
  try {
    const r = await optimize({ config: loaded.config, hash: loaded.hash, cwd: io.cwd, budget: args.numbers.budget, batch: args.numbers.batch, confidence: args.numbers.confidence, alpha: args.numbers.alpha, minPerArm: args.numbers["min-per-arm"], seed: args.numbers.seed, useCache: !args.flags["no-cache"], log: (s) => io.stderr(s) });
    if (args.flags.json) io.stdout(`${JSON.stringify(r, null, 2)}\n`);
    else io.stdout(`${renderOptimize(r)}wrote ${path.relative(io.cwd, r.path)}\n`);
    return 0;
  } catch (e) {
    io.stderr(`optimize failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
