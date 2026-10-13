import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TargetSpec } from "../core/config";
import { cacheKey } from "../core/cache";
import type { ChatMessage } from "../core/types";
import { costOf, priceOf } from "../providers/pricing";
import bridgeSource from "./python/hone_bridge.py" with { type: "text" };
import { registerTargetKind, type RunContext, type Target, type TargetOutput } from "./target";

export interface PythonTargetSpec extends TargetSpec {
  kind: "python";
  module: string;
  fn?: string;
  python?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Handed to the callable as `ctx.params`: what a change alters (a prompt, a model, a setting). */
  params?: Record<string, unknown>;
  /** Calls the bridge serves at once, on threads (default 1). Agent calls wait on a model, so a suite finishes sooner; a handler that is not thread-safe keeps 1. */
  workers?: number;
  /** What the cache keys on. By default a hash of the Python files under `cwd`, so editing the agent or anything it imports from there runs it again; name it yourself when the files cannot show what changed (a remote index, a prompt registry). */
  version?: string | (() => Promise<string>);
  /** `"inherit"` shows what the module prints and logs as it runs. By default it is kept out of hone's output, and the last of it comes with the error when the process dies or a call times out. */
  stderr?: "inherit";
}

interface BridgeError {
  type: string;
  message: string;
  traceback: string;
}
interface BridgeLine {
  id: string | null;
  ready?: boolean;
  result?: TargetOutput;
  error?: BridgeError;
}

const NOT_SOURCE = new Set(["node_modules", "__pycache__", "site-packages"]);

/** A hash of the Python files under `root`: the code a target there runs. Hidden directories and virtual environments are not its own code.
 *  ponytail: reads every .py file on each run; in a tree with very many of them, set `version` on the target instead. */
function sourceHash(root: string): string {
  const h = createHash("sha256");
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable: nothing of ours in there
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && !NOT_SOURCE.has(e.name) && !fs.existsSync(path.join(p, "pyvenv.cfg"))) walk(p);
      } else if (e.isFile() && e.name.endsWith(".py")) h.update(`${path.relative(root, p)}\0`).update(fs.readFileSync(p));
    }
  };
  walk(root);
  return h.digest("hex");
}

/** The bridge script is embedded at build time and materialised once per process. */
let bridgePath: string | undefined;
function materialiseBridge(): string {
  if (bridgePath && fs.existsSync(bridgePath)) return bridgePath;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-bridge-"));
  bridgePath = path.join(dir, "hone_bridge.py");
  fs.writeFileSync(bridgePath, bridgeSource);
  return bridgePath;
}

class PythonProcess {
  private proc: ReturnType<typeof Bun.spawn> | undefined;
  private pending = new Map<string, { resolve: (l: BridgeLine) => void }>();
  private ready: Promise<BridgeError | undefined> | undefined;
  private seq = 0;
  /** The end of what the process wrote to stderr (its own prints included: the bridge sends stdout there). */
  private said = "";

  constructor(private readonly spec: PythonTargetSpec) {}

  private start(): Promise<BridgeError | undefined> {
    const proc = Bun.spawn([this.spec.python ?? "python3", "-I", materialiseBridge(), this.spec.module, this.spec.fn ?? "handler", String(Math.max(1, Math.floor(this.spec.workers ?? 1)))], {
      cwd: this.spec.cwd,
      env: { ...process.env, ...this.spec.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: this.spec.stderr === "inherit" ? "inherit" : "pipe",
    });
    this.proc = proc;
    this.said = "";
    let resolveReady!: (e: BridgeError | undefined) => void;
    const ready = new Promise<BridgeError | undefined>((r) => (resolveReady = r));
    this.ready = ready;
    void this.readLines(proc, resolveReady);
    const drained = this.spec.stderr === "inherit" ? Promise.resolve() : this.keepStderr(proc);
    void Promise.all([proc.exited, drained]).then(([code]) => {
      if (this.proc === proc) this.proc = undefined;
      const error: BridgeError = { type: "ProcessExit", message: `python process exited with code ${code}${this.lastSaid()}`, traceback: "" };
      resolveReady(error);
      for (const [id, p] of this.pending) {
        this.pending.delete(id);
        p.resolve({ id, error });
      }
    });
    return ready;
  }

  /** Frameworks log and warn on stderr all the time; that is the module's output, not hone's. Only the end is kept, for when something goes wrong. */
  private async keepStderr(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) this.said = (this.said + decoder.decode(chunk, { stream: true })).slice(-4000);
  }

  private lastSaid(): string {
    const tail = this.said.trim().slice(-300);
    return tail ? `: ${tail}` : "";
  }

  private async readLines(proc: ReturnType<typeof Bun.spawn>, resolveReady: (e: BridgeError | undefined) => void): Promise<void> {
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: BridgeLine;
        try {
          msg = JSON.parse(line) as BridgeLine;
        } catch {
          continue;
        }
        if (msg.id === null) {
          resolveReady(msg.ready ? undefined : msg.error);
          continue;
        }
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.resolve(msg);
        }
      }
    }
  }

  async call(payload: { input: unknown; ctx: Record<string, unknown> }, timeoutMs: number): Promise<BridgeLine> {
    if (!this.proc) {
      const importError = await this.start();
      if (importError) return { id: null, error: importError };
    } else {
      const importError = await this.ready;
      if (importError) return { id: null, error: importError };
    }
    const proc = this.proc;
    if (!proc) return { id: null, error: { type: "ProcessExit", message: "python process exited", traceback: "" } };
    const id = `r${++this.seq}`;
    const line = new Promise<BridgeLine>((resolve) => this.pending.set(id, { resolve }));
    (proc.stdin as import("bun").FileSink).write(`${JSON.stringify({ id, ...payload })}\n`);
    (proc.stdin as import("bun").FileSink).flush();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<BridgeLine>((resolve) => {
      timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          proc.kill();
          resolve({ id, error: { type: "Timeout", message: `python call timed out after ${timeoutMs}ms${this.lastSaid()}`, traceback: "" } });
        }
      }, timeoutMs);
    });
    // an answered call must not leave its timer running: it would keep the caller's process alive for the whole timeout
    return Promise.race([line, timeout]).finally(() => clearTimeout(timer));
  }

  async close(): Promise<void> {
    const proc = this.proc;
    this.proc = undefined;
    if (!proc) return;
    try {
      (proc.stdin as import("bun").FileSink).end();
    } catch {
      // already closed
    }
    proc.kill();
    await proc.exited;
  }
}

export function pythonTarget(id: string, spec: PythonTargetSpec): Target {
  const timeoutMs = spec.timeoutMs ?? 120_000;
  const process_ = new PythonProcess(spec);

  const run = async (input: unknown, ctx: RunContext, prefix?: ChatMessage[]): Promise<TargetOutput> => {
    const line = await process_.call({ input, ctx: { caseId: ctx.caseId, trial: ctx.trial, prefix: prefix ?? null, params: spec.params ?? null } }, timeoutMs);
    if (line.error) {
      const out: TargetOutput = { output: null, error: `${line.error.type}: ${line.error.message}` };
      if (line.error.traceback) out.meta = { traceback: line.error.traceback };
      return out;
    }
    const r = line.result ?? { output: null };
    const out: TargetOutput = { output: r.output ?? null };
    if (r.messages) out.messages = r.messages;
    if (r.spans) out.spans = r.spans;
    if (r.usage) out.usage = r.usage;
    // tokens with a model name and no cost: price them from the table, so cost per case is there without the handler doing arithmetic
    const model = typeof r.meta?.model === "string" ? r.meta.model : undefined;
    if (out.usage && !out.usage.costUsd && model && priceOf(model)) out.usage = { ...out.usage, costUsd: costOf(model, out.usage.inputTokens ?? 0, out.usage.outputTokens ?? 0) };
    if (r.artifacts) out.artifacts = r.artifacts;
    if (r.error !== undefined) out.error = String(r.error);
    if (r.meta) out.meta = r.meta;
    return out;
  };

  return {
    id,
    kind: "python",
    async version() {
      if (typeof spec.version === "string") return spec.version;
      if (typeof spec.version === "function") return spec.version();
      // The module is rarely the whole agent: its tools and prompts sit in the files next to it. An edit to any of them
      // has to run the cases again, so the version covers the Python source of the working directory (and of the
      // module's own directory when that lies outside it).
      const cwd = path.resolve(spec.cwd ?? process.cwd());
      const file = path.resolve(cwd, spec.module);
      const outside = spec.module.endsWith(".py") && fs.existsSync(file) && !file.startsWith(cwd + path.sep);
      const source = [cwd, ...(outside ? [path.dirname(file)] : [])].map(sourceHash);
      // params and env are part of what runs: two variants of one module must not share cached outputs
      return cacheKey({ kind: "python", module: spec.module, fn: spec.fn ?? "handler", source, params: spec.params ?? null, env: spec.env ?? null });
    },
    run: (input, ctx) => run(input, ctx, ctx.prefix),
    resume: (prefix, input, ctx) => run(input, ctx, prefix),
    close: () => process_.close(),
  };
}

registerTargetKind("python", (id, spec) => pythonTarget(id, spec as PythonTargetSpec));
