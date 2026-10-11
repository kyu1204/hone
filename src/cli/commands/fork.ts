import * as fs from "node:fs";
import * as path from "node:path";
import { pickSibling } from "../../analysis/branchpoints";
import { divergenceReport } from "../../analysis/diffTrace";
import { ConfigNotFound } from "../../core/config";
import { Store } from "../../core/store";
import type { ChatMessage, Trial } from "../../core/types";
import { forkTrial, loadForkDeps } from "../../correct/fork";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import { cell } from "./diff";
import { renderBranchPoints } from "./explain";
import type { CommandIo } from "./run";

export const FORK_SPEC = { flags: ["json"], strings: ["content", "file"], numbers: ["step"], repeatable: [] } as const;
const HELP: Record<string, string> = { step: "index of the message to replace (omit to list fork candidates)", content: "replacement text for that message", file: "read the replacement text from a file", json: "print the forked trial" };

export function forkUsage(): string {
  return `usage: hone fork <trialId> [--step n (--content text | --file path)] [--json]\n\nReplace one message of a trial, re-run the target from that prefix, and compare the verdicts.\n\n${usageLine(FORK_SPEC, HELP)}\n`;
}

const verdict = (t: Trial): string => (t.pass === true ? "PASS" : t.pass === false ? "FAIL" : "UNDECIDED");

export async function forkCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, FORK_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${forkUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(forkUsage());
    return 0;
  }
  const id = args.positionals[0];
  if (!id) {
    io.stderr(forkUsage());
    return 2;
  }
  const store = new Store(await storeRoot(io));
  try {
    const original = store.getTrial(id);
    if (!original) {
      io.stderr(`trial ${id} not found\n`);
      return 2;
    }
    const step = args.numbers.step;
    if (step === undefined) {
      const lines = renderBranchPoints(original, pickSibling(original, store.queryTrials({ runId: original.runId, caseId: original.trace.caseId, pass: true })));
      io.stdout(lines.length ? `${lines.slice(1).join("\n")}\n` : `no fork candidates for ${id}; pick a step with --step\n`);
      return 0;
    }
    const target = original.trace.messages[step];
    if (!Number.isInteger(step) || !target) {
      io.stderr(`step ${step} out of range (trial has ${original.trace.messages.length} messages)\n`);
      return 2;
    }
    let content = args.values.content?.[0];
    if (content === undefined && args.values.file?.[0]) content = fs.readFileSync(path.resolve(io.cwd, args.values.file[0]), "utf8").replace(/\n$/, "");
    if (content === undefined) {
      io.stderr(`--content or --file is required with --step\n`);
      return 2;
    }
    let deps;
    try {
      deps = await loadForkDeps(io.cwd);
    } catch (e) {
      io.stderr(`${e instanceof ConfigNotFound ? e.message : `config error: ${e instanceof Error ? e.message : String(e)}`}\n`);
      return 2;
    }
    const edited: ChatMessage = { ...target, content };
    const forked = await forkTrial({ store, targets: deps.targets, scorers: deps.scorers, caseInput: deps.caseInputs[original.trace.caseId], original, step, edited, log: (l) => io.stderr(`${l}\n`) });
    const rows = divergenceReport(original.trace.messages, forked.trace.messages).filter((r) => r.kind !== "identical");
    if (args.flags.json) {
      io.stdout(`${JSON.stringify({ from: original.id, step, forked, divergence: rows }, null, 2)}\n`);
      return 0;
    }
    const lines = [`forked trial ${forked.id}: ${verdict(original)} -> ${verdict(forked)}   cost $${forked.costUsd.toFixed(4)}`, "", "scores:"];
    for (const s of forked.scores) lines.push(`  ${s.pass === true ? "✓" : s.pass === false ? "✗" : "?"} ${s.scorer.padEnd(20)} ${s.value.toFixed(2)}  ${s.reason ?? ""}`);
    lines.push("", `divergence (${rows.length} rows):`);
    for (const r of rows) lines.push(`${String(r.step).padStart(3)} ${cell(r.aMessage, 40)} │ ${cell(r.bMessage, 40)}  ${r.kind}`);
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  } finally {
    store.close();
  }
}
