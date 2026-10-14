// The QA engineer's first job, done by hone's model: read what the agent is for, and write the cases that check it, in
// the grammar of the `agent` scorer. The cases are drafts: a person, or a coding agent, keeps the ones that are right.
import * as fs from "node:fs";
import * as path from "node:path";
import type { HoneConfig } from "../core/config";
import type { Case } from "../core/types";
import { AGENT_KEYS } from "../scorers/agent";
import type { ChatFn } from "./evolve";

export interface DraftOptions {
  config: HoneConfig;
  cwd: string;
  chat: ChatFn;
  /** The cases there are: their form is followed and their ids are not repeated. */
  existing: Case[];
  /** Files that say what the agent is (relative to cwd). Default: a python target's module and the files next to it that it imports. */
  read?: string[];
  count?: number;
}

export interface DraftResult {
  cases: Case[];
  /** Why a drafted case was not kept, one line each. */
  dropped: string[];
  read: string[];
}

/** A python target's module, and the modules next to it that it imports by name: usually where the tools and the rules are. */
export function defaultReads(config: HoneConfig, cwd: string): string[] {
  const out: string[] = [];
  for (const t of Object.values(config.targets)) {
    if (t.kind !== "python" || typeof t.module !== "string") continue;
    const base = path.resolve(cwd, typeof t.cwd === "string" ? t.cwd : ".");
    const file = t.module.endsWith(".py") ? path.resolve(base, t.module) : path.join(base, `${t.module}.py`);
    if (!fs.existsSync(file)) continue;
    const add = (f: string) => {
      const rel = path.relative(cwd, f);
      if (!out.includes(rel)) out.push(rel);
    };
    add(file);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w., ]+))/gm)) {
      for (const name of (m[1] ?? m[2] ?? "").split(",").map((x) => x.trim().split(/[.\s]/)[0]!)) {
        const sibling = path.join(path.dirname(file), `${name}.py`);
        if (name && fs.existsSync(sibling)) add(sibling);
      }
    }
  }
  return out;
}

// ponytail: a fixed share of the context window for the files; beyond it they are cut, and the prompt says so
const MAX_CHARS = 60_000;

const SYSTEM = `You are a QA engineer who writes test cases for an AI agent. You get what the agent is for: its system prompt, its source code (tools, data, policies) and documents. Write the cases a careful QA engineer would write: the main jobs, every rule the documents state or clearly imply, edge cases, and requests it must refuse or hand on. Each case is one message from a user and what must hold in the agent's reply and tool calls.

Reply with JSON only: {"cases":[{"id":"kebab-case-id","input":"what the user writes","expected":{...},"why":"the rule or job it checks"}]}

expected may use:
- calls: tools that must be called; never: tools that must not be called; order: tools in the order they must be called
- args: {"tool":{"argument":"value"}} for argument values the documents fix
- says, never_says: exact phrases the answer must or must not contain, only when the documents fix the wording
- judge: a rule in words, for what no exact check can decide

Use only tool names that exist in the code. Do not invent rules the documents do not support. Follow the form of the existing cases' input.`;

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === "string" && s.trim() !== "");

/** Why a drafted case cannot be kept, or undefined when it can. */
function problem(c: Record<string, unknown>, code: string): string | undefined {
  if (!("input" in c) || c.input === null || c.input === "") return "no input";
  const e = c.expected;
  if (typeof e !== "object" || e === null || Array.isArray(e) || Object.keys(e).length === 0 || Object.keys(e).some((k) => !(AGENT_KEYS as readonly string[]).includes(k))) return `expected may only say ${AGENT_KEYS.slice(0, -1).join(", ")} or ${AGENT_KEYS.at(-1)}`;
  const x = e as Record<string, unknown>;
  for (const k of ["calls", "never", "order", "says", "never_says"]) if (k in x && !isStrings(x[k])) return `${k} is a list of words`;
  if ("judge" in x && !(typeof x.judge === "string" ? x.judge.trim() !== "" : isStrings(x.judge))) return "judge is a rule in words";
  if ("args" in x && (typeof x.args !== "object" || x.args === null || Object.values(x.args).some((v) => typeof v !== "object" || v === null))) return "args is { tool: { argument: value } }";
  const tools = [...((x.calls as string[]) ?? []), ...((x.never as string[]) ?? []), ...((x.order as string[]) ?? []), ...Object.keys((x.args as object) ?? {})];
  const unknown = [...new Set(tools.filter((t) => !code.includes(t)))];
  return unknown.length ? `names a tool the code does not have: ${unknown.join(", ")}` : undefined;
}

export async function draftCases(opts: DraftOptions): Promise<DraftResult> {
  const read = opts.read?.length ? opts.read : defaultReads(opts.config, opts.cwd);
  const seed = opts.config.sharpen?.text?.seed;
  if (!read.length && seed === undefined) throw new Error("nothing to read about the agent: pass --read <file> for the files that define it, or declare its prompt in sharpen.text");
  let files = read.map((f) => `=== ${f} ===\n${fs.readFileSync(path.resolve(opts.cwd, f), "utf8")}`).join("\n\n");
  if (files.length > MAX_CHARS) files = `${files.slice(0, MAX_CHARS)}\n[the files are cut here, at ${MAX_CHARS} of ${files.length} characters]`;
  const count = opts.count ?? 20;
  const existing = opts.existing.slice(0, 12).map((c) => ({ id: c.id, input: c.input, expected: c.expected }));
  const user = `The agent's system prompt:\n${seed ?? "(not declared)"}\n\nFiles:\n${files || "(none)"}\n\nExisting cases (do not repeat them; follow the form of their input):\n${existing.length ? JSON.stringify(existing, null, 1) : "(none)"}\n\nWrite ${count} new cases.`;
  const reply = await opts.chat({ system: SYSTEM, json: true, temperature: 0.4, maxTokens: 12_000, messages: [{ role: "user", content: user }] });
  let drafted: unknown;
  try {
    drafted = (JSON.parse(reply.text.slice(reply.text.indexOf("{"), reply.text.lastIndexOf("}") + 1)) as { cases?: unknown }).cases;
  } catch {
    drafted = undefined;
  }
  if (!Array.isArray(drafted)) throw new Error(`the model did not reply with cases: ${reply.text.slice(0, 160)}`);

  const taken = new Set(opts.existing.map((c) => c.id));
  const code = `${seed ?? ""}\n${files}`;
  const cases: Case[] = [];
  const dropped: string[] = [];
  for (const raw of drafted as Record<string, unknown>[]) {
    const e = raw?.expected as Record<string, unknown> | undefined;
    // a model often writes one word where a list is expected: that is a list of one
    if (e && typeof e === "object") for (const k of ["calls", "never", "order", "says", "never_says"]) if (typeof e[k] === "string") e[k] = [e[k]];
    const name = typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : "?";
    const why = problem(raw ?? {}, code);
    if (why) {
      dropped.push(`${name}: ${why}`);
      continue;
    }
    let id = name === "?" ? `drafted-${cases.length + 1}` : name;
    for (let n = 2; taken.has(id); n++) id = `${name}-${n}`;
    taken.add(id);
    cases.push({ id, input: raw.input, expected: raw.expected, tags: ["drafted"], ...(typeof raw.why === "string" && raw.why ? { meta: { why: raw.why } } : {}) });
  }
  return { cases, dropped, read };
}
