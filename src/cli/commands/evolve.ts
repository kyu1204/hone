import * as path from "node:path";
import { ConfigNotFound, loadConfig } from "../../core/config";
import { type ChatFn, evolve, type EvolveFile } from "../../correct/evolve";
import { chat, resolveLlmProvider } from "../../providers/llm";
import { ArgError, parseArgs, usageLine } from "../args";
import type { CommandIo } from "./run";

export const EVOLVE_SPEC = { flags: ["json", "no-cache"], strings: [], numbers: ["budget", "minibatch", "trials", "max-cost", "alpha"], repeatable: [] } as const;
const HELP: Record<string, string> = { budget: "candidates to propose (default 6)", minibatch: "passing cases added to each minibatch (default 8)", trials: "trials per case", "max-cost": "stop when total spend (USD) reaches this", alpha: "significance for the final paired verdict (default 0.05)", "no-cache": "re-run targets instead of using cached outputs", json: "print the result as JSON" };

export function evolveUsage(): string {
  return `usage: hone evolve [--budget 6] [--minibatch 8] [--trials n] [--max-cost usd] [--alpha 0.05] [--no-cache] [--json]\n\nReflect on failures, propose revised text, verify on a minibatch then the full set, and keep the versions no other beats on both pass rate and cost (the text is config.sharpen.text).\n\n${usageLine(EVOLVE_SPEC, HELP)}\n`;
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function renderEvolve(file: EvolveFile, verdict: string): string {
  const lines = ["  candidate   pass@1   95% CI        cost     pareto  note"];
  const row = (c: EvolveFile["candidates"][number] | EvolveFile["baseline"]): string => {
    const x = c as EvolveFile["candidates"][number];
    const note = x.rejected === "unparseable" ? "reply not JSON" : x.rejected === "minibatch" ? `rejected on minibatch (${pct(x.minibatch!.candidate)} vs ${pct(x.minibatch!.parent)})` : x.rationale ? clip(x.rationale, 50) : "";
    return `  ${c.id.padEnd(11)} ${pct(c.passAt1).padStart(6)}   [${pct(c.lo).padStart(4)}, ${pct(c.hi).padStart(4)}]  $${c.costUsd.toFixed(4)}  ${c.pareto ? "  ★   " : "      "}  ${note}`;
  };
  lines.push(row(file.baseline));
  for (const c of file.candidates) lines.push(row(c));
  lines.push("", `verdict: ${verdict}`);
  return `${lines.join("\n")}\n`;
}

export async function evolveCommand(argv: string[], io: CommandIo, deps: { chat?: ChatFn } = {}): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, EVOLVE_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${evolveUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(evolveUsage());
    return 0;
  }
  let loaded;
  try {
    loaded = await loadConfig(io.cwd);
  } catch (e) {
    io.stderr(`${e instanceof ConfigNotFound ? e.message : `config error: ${e instanceof Error ? e.message : String(e)}`}\n`);
    return 2;
  }
  if (!loaded.config.sharpen?.text) {
    io.stderr("config declares no text to rewrite; add `sharpen: { text: { seed, apply } }` to hone.config.ts\n");
    return 2;
  }
  const chatFn: ChatFn = deps.chat ?? ((req) => chat(req, { provider: resolveLlmProvider(io.env, { cwd: io.cwd }) }));
  try {
    const r = await evolve({ config: loaded.config, hash: loaded.hash, cwd: io.cwd, chat: chatFn, budget: args.numbers.budget, minibatch: args.numbers.minibatch, trials: args.numbers.trials, maxCost: args.numbers["max-cost"], alpha: args.numbers.alpha, useCache: !args.flags["no-cache"], log: (s) => io.stderr(s) });
    if (args.flags.json) io.stdout(`${JSON.stringify(r, null, 2)}\n`);
    else io.stdout(`${renderEvolve(r.file, r.verdict)}wrote ${path.relative(io.cwd, r.path)}${r.stopped === "maxCost" ? " (stopped: max cost reached)" : ""}\n`);
    return 0;
  } catch (e) {
    io.stderr(`evolve failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
