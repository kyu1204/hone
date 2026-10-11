import { pairedMde, pairedPowerN, withDesign } from "../../stats/power";
import { ArgError, parseArgs, usageLine } from "../args";
import type { CommandIo } from "./run";

export const POWER_SPEC = {
  flags: ["json"],
  strings: [],
  numbers: ["effect", "n", "alpha", "power", "pairing-corr", "repeats", "noise-share", "icc", "cluster-size"],
  repeatable: [],
} as const;

const HELP: Record<string, string> = {
  json: "print as JSON",
  effect: "standardized paired effect to detect (prints required pairs)",
  n: "pairs available (prints the minimum detectable effect)",
  alpha: "significance level (default 0.05)",
  power: "target power (default 0.8)",
  "pairing-corr": "correlation between the two arms per case (reduces n)",
  repeats: "trials per case (reduces the decoding-noise share)",
  "noise-share": "share of variance that is decoding noise (default 1 with --repeats)",
  icc: "intraclass correlation when cases share clusters (with --cluster-size)",
  "cluster-size": "average cases per cluster",
};

export function powerUsage(): string {
  return `usage: hone power --effect d [design options]\n       hone power --n N\n\nHow many cases a paired comparison needs, or the smallest effect N cases can detect.\n\n${usageLine(POWER_SPEC, HELP)}\n`;
}

export async function powerCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, POWER_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${powerUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(powerUsage());
    return 0;
  }
  const alpha = args.numbers.alpha ?? 0.05;
  const power = args.numbers.power ?? 0.8;
  const effect = args.numbers.effect;
  const n = args.numbers.n;
  if (effect === undefined && n === undefined) {
    io.stderr(`pass --effect or --n\n${powerUsage()}`);
    return 2;
  }
  if (effect !== undefined) {
    const raw = pairedPowerN({ effect, alpha, power });
    const design = { pairingCorr: args.numbers["pairing-corr"], repeats: args.numbers.repeats, noiseShare: args.numbers["noise-share"], icc: args.numbers.icc, avgClusterSize: args.numbers["cluster-size"] };
    const adjusted = withDesign(raw, design);
    const hasDesign = Object.values(design).some((v) => v !== undefined);
    if (args.flags.json) io.stdout(`${JSON.stringify({ mode: "n", effect, alpha, power, pairs: raw, adjustedPairs: adjusted, design })}\n`);
    else {
      io.stdout(`required pairs: ${raw.toFixed(1)} pairs to detect effect ${effect} at alpha ${alpha} with power ${power}\n`);
      if (hasDesign) io.stdout(`after design adjustments: ${adjusted.toFixed(1)} pairs\n`);
    }
    return 0;
  }
  const mde = pairedMde({ n: n!, alpha, power });
  if (args.flags.json) io.stdout(`${JSON.stringify({ mode: "mde", n, alpha, power, effect: mde })}\n`);
  else io.stdout(`minimum detectable effect with ${n} pairs: ${mde.toFixed(2)} (standardized) at alpha ${alpha} with power ${power}\n`);
  return 0;
}
