import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TargetSpec } from "../core/config";
import { cacheKey } from "../core/cache";
import type { ChatMessage, Span } from "../core/types";
import { type ParsedStream, parseClaudeStream } from "./parsers/claudeCode";
import { parseCodexStream } from "./parsers/codex";
import { parseOpencodeStream } from "./parsers/opencode";
import { registerTargetKind, type RunContext, type Target, type TargetOutput } from "./target";

export type AgentPreset = "claude-code" | "codex" | "opencode" | "aider" | "generic";

export interface ProcessTargetSpec extends TargetSpec {
  kind: "process";
  agent: AgentPreset;
  workspace: string;
  isolate?: "copy" | "worktree" | "none";
  timeoutMs?: number;
  model?: string;
  env?: Record<string, string>;
  /** Required for generic. Placeholders: {prompt} {model} {workspace}. */
  command?: string[];
}

const PRESETS: Record<Exclude<AgentPreset, "generic">, { argv: string[]; modelFlag: string[] }> = {
  "claude-code": { argv: ["claude", "-p", "{prompt}", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"], modelFlag: ["--model", "{model}"] },
  codex: { argv: ["codex", "exec", "--json", "{prompt}"], modelFlag: ["--model", "{model}"] },
  opencode: { argv: ["opencode", "run", "--format", "json", "{prompt}"], modelFlag: ["--model", "{model}"] },
  aider: { argv: ["aider", "--message", "{prompt}", "--yes-always", "--no-auto-commits"], modelFlag: ["--model", "{model}"] },
};

const SKIP_COPY = new Set(["node_modules", ".hone"]);
const GIT_ENV = { GIT_AUTHOR_NAME: "hone", GIT_AUTHOR_EMAIL: "hone@localhost", GIT_COMMITTER_NAME: "hone", GIT_COMMITTER_EMAIL: "hone@localhost" };

function git(cwd: string, args: string[]): { code: number; stdout: string } {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...GIT_ENV }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, stdout: r.stdout.toString() };
}

// What a running Claude Code session exports to its own children. hone is often started from inside such a session; an
// agent it launches must not come up as that session's child (its effort level, its session id, its messaging socket).
const SESSION_ENV = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_EXECPATH", "CLAUDE_EFFORT", "CLAUDE_PID"];

/** The child's environment: hone's own, minus the launching session's variables, plus the target's `env` (which always wins). */
function childEnv(extra?: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of SESSION_ENV) delete env[k];
  return { ...env, ...extra };
}

/** Render a message prefix as markdown sections for agents that cannot resume a session. */
export function renderPrefix(prefix: ChatMessage[]): string {
  return prefix
    .map((m) => {
      const head = m.role === "tool" ? `### tool ${m.name ?? m.tool_call_id ?? ""}`.trim() : `### ${m.role}`;
      const body = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("\n");
      const calls = m.tool_calls?.map((c) => `[tool_call ${c.function.name} ${c.function.arguments}]`).join("\n");
      return [head, body, calls].filter((s) => s !== undefined && s !== "").join("\n");
    })
    .join("\n\n");
}

const binVersions = new Map<string, string>();
function binVersion(bin: string): string {
  const cached = binVersions.get(bin);
  if (cached !== undefined) return cached;
  let v = "";
  try {
    const r = Bun.spawnSync([bin, "--version"], { stdout: "pipe", stderr: "pipe" });
    v = r.exitCode === 0 ? r.stdout.toString().trim().slice(0, 100) : "";
  } catch {
    v = "";
  }
  binVersions.set(bin, v);
  return v;
}

export function processTarget(id: string, spec: ProcessTargetSpec): Target {
  const isolate = spec.isolate ?? "copy";
  const timeoutMs = spec.timeoutMs ?? 600_000;
  /** `{caseId}` in the workspace path gives every case its own directory (benchmarks with one repo per task). */
  const workspaceFor = (caseId: string): string => path.resolve(spec.workspace.replaceAll("{caseId}", caseId));
  const temps: { dir: string; source: string }[] = [];
  if (spec.agent === "generic" && !spec.command?.length) throw new Error(`process target "${id}": generic agent needs a command`);

  const argvTemplate = (): string[] => {
    if (spec.agent === "generic") return spec.command!;
    const p = PRESETS[spec.agent];
    return spec.command ?? [...p.argv, ...(spec.model ? p.modelFlag : [])];
  };

  const prepare = (workspace: string): string => {
    if (!fs.existsSync(workspace)) throw new Error(`workspace ${workspace} does not exist`);
    if (isolate === "none") {
      if (!fs.existsSync(path.join(workspace, ".git"))) throw new Error("isolate: none needs a git repository in the workspace");
      return workspace;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-ws-"));
    temps.push({ dir, source: workspace });
    if (isolate === "worktree") {
      const r = git(workspace, ["worktree", "add", "--detach", dir, "HEAD"]);
      if (r.code !== 0) throw new Error(`git worktree add failed in ${workspace}`);
      return dir;
    }
    fs.cpSync(workspace, dir, { recursive: true, filter: (src) => !SKIP_COPY.has(path.basename(src)) });
    // node_modules is not copied (large) but linked, so tests and tools in the copy still resolve dependencies
    const nm = path.join(workspace, "node_modules");
    if (fs.existsSync(nm)) fs.symlinkSync(fs.realpathSync(nm), path.join(dir, "node_modules"));
    if (!fs.existsSync(path.join(dir, ".git"))) {
      git(dir, ["init", "-q"]);
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-q", "--allow-empty", "-m", "hone baseline"]);
    }
    return dir;
  };

  const diffOf = (dir: string): string => {
    let diff = git(dir, ["diff"]).stdout;
    const untracked = git(dir, ["ls-files", "--others", "--exclude-standard"]).stdout.split("\n").filter(Boolean);
    for (const f of untracked) diff += git(dir, ["diff", "--no-index", "--", "/dev/null", f]).stdout;
    return diff;
  };

  const parse = (stdout: string): ParsedStream => {
    switch (spec.agent) {
      case "claude-code":
        return parseClaudeStream(stdout);
      case "codex":
        return parseCodexStream(stdout);
      case "opencode":
        return parseOpencodeStream(stdout);
      case "aider":
        return { output: stdout.trim(), messages: [], spans: [], usage: {}, meta: {} };
      default: {
        const t = stdout.trim();
        if (t.startsWith("{")) {
          try {
            const j = JSON.parse(t) as Partial<ParsedStream> & { artifacts?: unknown };
            if ("output" in j) return { output: j.output, messages: j.messages ?? [], spans: j.spans ?? [], usage: j.usage ?? {}, meta: j.meta ?? {} };
          } catch {
            // plain text output
          }
        }
        return { output: t, messages: [], spans: [], usage: {}, meta: {} };
      }
    }
  };

  const run = async (input: unknown, ctx: RunContext, prefix?: ChatMessage[]): Promise<TargetOutput> => {
    const instruction = typeof input === "string" ? input : typeof input === "object" && input && "prompt" in input ? String((input as { prompt: unknown }).prompt) : JSON.stringify(input);
    const prompt = prefix?.length ? `${renderPrefix(prefix)}\n\n### user\n${instruction}` : instruction;
    let dir: string;
    try {
      dir = prepare(workspaceFor(ctx.caseId));
    } catch (e) {
      return { output: null, error: e instanceof Error ? e.message : String(e) };
    }
    const sub = (s: string) => s.replaceAll("{prompt}", prompt).replaceAll("{model}", spec.model ?? "").replaceAll("{workspace}", dir);
    const argv = argvTemplate().map(sub);
    const startedAt = new Date().toISOString();
    const proc = Bun.spawn(argv, { cwd: dir, env: childEnv(spec.env), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    const onAbort = () => proc.kill("SIGKILL");
    ctx.signal?.addEventListener("abort", onAbort);
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onAbort);
    const endedAt = new Date().toISOString();

    const parsed = parse(stdout);
    const agentSpan: Span = { id: "agent", kind: "agent", name: spec.agent, startedAt, endedAt, input: prompt, output: parsed.output, attrs: { argv0: argv[0], exitCode: code } };
    const spans = [agentSpan, ...parsed.spans.map((s) => ({ ...s, parentId: s.parentId ?? "agent" }))];
    const systemMsgs = parsed.messages.filter((m) => m.role === "system");
    const rest = parsed.messages.filter((m) => m.role !== "system");
    const messages: ChatMessage[] = [...systemMsgs, ...(prefix ?? []), { role: "user", content: instruction }, ...rest];
    const out: TargetOutput = {
      output: parsed.output,
      messages,
      spans,
      usage: parsed.usage,
      artifacts: { diff: diffOf(dir), stdout, stderr },
      meta: { ...parsed.meta, agent: spec.agent, workspace: dir, ...(prefix?.length ? { resumeMode: "rendered-prefix" } : {}) },
    };
    if (timedOut) out.error = "timeout";
    else if (code !== 0) {
      // agents often give the reason on stdout (Claude Code: "You've hit your session limit"), so fall back to it
      const said = typeof parsed.output === "string" && parsed.output.trim() !== "" ? parsed.output.trim() : stdout.trim().slice(-300);
      out.error = `${spec.agent} exited with exit code ${code}: ${(stderr.trim() || said).slice(0, 300)}`;
    }
    return out;
  };

  return {
    id,
    kind: "process",
    async version() {
      const argv = argvTemplate();
      return cacheKey({ kind: "process", agent: spec.agent, command: argv, model: spec.model ?? null, bin: binVersion(argv[0] ?? "") });
    },
    run: (input, ctx) => run(input, ctx, ctx.prefix),
    resume: (prefix, input, ctx) => run(input, ctx, prefix),
    async close() {
      for (const { dir, source } of temps.splice(0)) {
        if (isolate === "worktree") git(source, ["worktree", "remove", "--force", dir]);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

registerTargetKind("process", (id, spec) => processTarget(id, spec as ProcessTargetSpec));
