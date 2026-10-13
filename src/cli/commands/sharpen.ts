import { ConfigNotFound, loadConfig } from "../../core/config";
import type { ChatFn } from "../../correct/evolve";
import { sharpen } from "../../correct/sharpen";
import { chat, LlmConfigError, resolveLlmProvider } from "../../providers/llm";
import { ArgError, parseArgs, usageLine } from "../args";
import type { CommandIo } from "./run";

export const SHARPEN_SPEC = { flags: ["json", "no-cache", "quiet"], strings: [], numbers: ["budget", "max-cost", "until", "trials", "holdout", "seed", "alpha"], repeatable: [] } as const;
const HELP: Record<string, string> = {
  budget: "changes to try (default 6)",
  "max-cost": "stop trying changes when the spend on the system under test (USD) reaches this",
  until: "stop trying changes once this pass rate is reached, e.g. 0.9",
  trials: "trials per case",
  holdout: "share of the cases kept away from every proposal for the final check (default 0.33)",
  seed: "seed of the held-out split",
  alpha: "significance level of the final check (default 0.05)",
  "no-cache": "re-run the system instead of using cached outputs",
  quiet: "no progress on stderr",
  json: "print the whole result as JSON",
};

export function sharpenUsage(): string {
  return `usage: hone sharpen [--budget 6] [--max-cost usd] [--until 0.9] [--trials n] [--holdout 0.33] [--seed n] [--no-cache] [--quiet] [--json]\n\nThe whole cycle: evaluate, find why cases fail, try changes (rewrites of config.sharpen.text, the variants in config.sharpen.variants, and both together), re-test them, and confirm the best one on cases no proposal has seen. Writes .hone/sharpen/<id>.json.\n\n${usageLine(SHARPEN_SPEC, HELP)}\n`;
}

export async function sharpenCommand(argv: string[], io: CommandIo, deps: { chat?: ChatFn } = {}): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, SHARPEN_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${sharpenUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(sharpenUsage());
    return 0;
  }
  let loaded;
  try {
    loaded = await loadConfig(io.cwd);
  } catch (e) {
    io.stderr(`${e instanceof ConfigNotFound ? e.message : `config error: ${e instanceof Error ? e.message : String(e)}`}\n`);
    return 2;
  }
  // without a key the cycle still tries the declared variants; it only cannot name failure modes or write rewrites
  let chatFn = deps.chat;
  if (!chatFn) {
    try {
      const provider = resolveLlmProvider(io.env, { cwd: io.cwd, home: io.env.HOME });
      chatFn = (req) => chat(req, { provider });
    } catch (e) {
      if (!(e instanceof LlmConfigError)) throw e;
    }
  }
  try {
    const r = await sharpen({ config: loaded.config, hash: loaded.hash, cwd: io.cwd, chat: chatFn, budget: args.numbers.budget, maxCost: args.numbers["max-cost"], until: args.numbers.until, trials: args.numbers.trials, holdout: args.numbers.holdout, seed: args.numbers.seed, alpha: args.numbers.alpha, useCache: args.flags["no-cache"] !== true, log: args.flags.quiet ? undefined : io.stderr });
    io.stdout(args.flags.json ? `${JSON.stringify(r, null, 2)}\n` : r.message);
    return r.verdict === "cannot measure" ? 1 : 0;
  } catch (e) {
    io.stderr(`sharpen failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
