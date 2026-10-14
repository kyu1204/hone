import * as fs from "node:fs";
import * as path from "node:path";
import { Cache } from "../../core/cache";
import { ConfigNotFound, loadCases, loadConfig } from "../../core/config";
import { Store } from "../../core/store";
import { runConfig } from "../../correct/ablation";
import { draftCases } from "../../correct/draft";
import type { ChatFn } from "../../correct/evolve";
import { chat, LlmConfigError, resolveLlmProvider } from "../../providers/llm";
import { ArgError, parseArgs, usageLine } from "../args";
import { renderCases } from "../detect";
import type { CommandIo } from "./run";

export const DRAFT_SPEC = {
  flags: [],
  strings: ["read"],
  numbers: ["count"],
  repeatable: ["read"],
} as const;

const HELP: Record<string, string> = {
  read: "a file that says what the agent is (repeatable; default: a python target's module and the files it imports)",
  count: "how many cases to draft (default 20)",
};

export function draftUsage(): string {
  return `usage: hone draft [--read file]... [--count 20]\n\nIn a project that has a config: hone's model reads what the agent is, drafts cases into evals/drafted.yaml, runs them once and says which fail. Needs an LLM key.\n\n${usageLine(DRAFT_SPEC, HELP)}\n`;
}

/** `hone draft`: the QA engineer's first job. Draft the cases, keep them where a person reviews them, run them once, say what fails. */
async function draftInto(io: CommandIo, read: string[] | undefined, count: number | undefined, deps: { chat?: ChatFn }): Promise<number> {
  let loaded: Awaited<ReturnType<typeof loadConfig>>;
  try {
    loaded = await loadConfig(io.cwd);
  } catch (e) {
    io.stderr(e instanceof ConfigNotFound ? "no hone.config.ts here: run hone init first, then hone draft\n" : `config error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  let chatFn = deps.chat;
  if (!chatFn) {
    try {
      const provider = resolveLlmProvider(io.env, { cwd: io.cwd, home: io.env.HOME });
      chatFn = (req) => chat(req, { provider });
    } catch (e) {
      if (!(e instanceof LlmConfigError)) throw e;
      io.stderr("drafting cases needs an LLM key (ANTHROPIC_API_KEY or OPENAI_API_KEY): hone init asks for one, or put it in ~/.config/hone/env\n");
      return 2;
    }
  }
  const file = path.join("evals", "drafted.yaml");
  const already = fs.existsSync(path.join(io.cwd, file)) ? await loadCases(file, io.cwd) : [];
  // the cases there are, the drafts of earlier runs included: their ids are not repeated
  const existing = [...(await loadCases(loaded.config.cases, io.cwd).catch(() => [])), ...already];
  let drafted: Awaited<ReturnType<typeof draftCases>>;
  try {
    drafted = await draftCases({ config: loaded.config, cwd: io.cwd, chat: chatFn, existing, read, count });
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  fs.mkdirSync(path.join(io.cwd, "evals"), { recursive: true });
  fs.writeFileSync(path.join(io.cwd, file), renderCases([...already, ...drafted.cases]));
  const from = [...drafted.read, ...(loaded.config.sharpen?.text ? ["the prompt in hone.config.ts"] : [])];
  const lines = [`Drafted ${drafted.cases.length} cases into ${file}${from.length ? `, from ${from.join(" and ")}` : ""}.`];
  if (drafted.dropped.length) lines.push(`Dropped ${drafted.dropped.length}: ${drafted.dropped.slice(0, 5).join("; ")}${drafted.dropped.length > 5 ? `; and ${drafted.dropped.length - 5} more` : ""}`);
  if (drafted.cases.length) {
    const root = path.resolve(io.cwd, loaded.config.cacheDir ?? ".hone");
    const store = new Store(root);
    try {
      const run = await runConfig({ ...loaded.config, cases: drafted.cases, trials: 1 }, "drafted cases", { cwd: io.cwd, store, cache: new Cache(path.join(root, "cache")), hash: loaded.hash, useCache: false });
      const failed = run.trials.filter((t) => t.pass === false);
      const undecided = run.trials.filter((t) => t.pass === null).length;
      lines.push(`Ran them once: ${run.trials.length - failed.length - undecided} passes, ${failed.length} fails${undecided ? `, ${undecided} undecided` : ""}.`);
      const width = Math.max(0, ...failed.map((t) => t.trace.caseId.length));
      for (const t of failed) {
        const why = t.trace.error ? `error: ${t.trace.error}` : t.scores.filter((x) => x.pass === false).map((x) => x.reason).join("; ");
        const row = `  ${t.trace.caseId.padEnd(width)}  ${why}`;
        lines.push(row.length > 100 ? `${row.slice(0, 97)}...` : row);
      }
    } finally {
      store.close();
    }
    const counted = await loadCases(loaded.config.cases, io.cwd).catch(() => []);
    if (!drafted.cases.every((c) => counted.some((x) => x.id === c.id))) lines.push(`The config's cases do not include ${file}: add it to \`cases\` to run these with hone test.`);
    lines.push(`Read ${file}: keep the cases that say what the agent should do and delete the rest. Then: hone test, hone sharpen.`);
  }
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}

export async function draftCommand(argv: string[], io: CommandIo, deps: { chat?: ChatFn } = {}): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, DRAFT_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${draftUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(draftUsage());
    return 0;
  }
  return draftInto(io, args.values.read, args.numbers.count, deps);
}
