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

  constructor(private readonly spec: PythonTargetSpec) {}

  private start(): Promise<BridgeError | undefined> {
    const proc = Bun.spawn([this.spec.python ?? "python3", "-I", materialiseBridge(), this.spec.module, this.spec.fn ?? "handler", String(Math.max(1, Math.floor(this.spec.workers ?? 1)))], {
      cwd: this.spec.cwd,
      env: { ...process.env, ...this.spec.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    this.proc = proc;
    let resolveReady!: (e: BridgeError | undefined) => void;
    const ready = new Promise<BridgeError | undefined>((r) => (resolveReady = r));
    this.ready = ready;
    void this.readLines(proc, resolveReady);
    void proc.exited.then((code) => {
      if (this.proc === proc) this.proc = undefined;
      resolveReady({ type: "ProcessExit", message: `python process exited with code ${code}`, traceback: "" });
      for (const [id, p] of this.pending) {
        this.pending.delete(id);
        p.resolve({ id, error: { type: "ProcessExit", message: `python process exited with code ${code}`, traceback: "" } });
      }
    });
    return ready;
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
          resolve({ id, error: { type: "Timeout", message: `python call timed out after ${timeoutMs}ms`, traceback: "" } });
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
      // params and env are part of what runs: two variants of one module must not share cached outputs
      const variant = spec.params || spec.env ? cacheKey({ params: spec.params ?? null, env: spec.env ?? null }) : "";
      const file = path.resolve(spec.cwd ?? process.cwd(), spec.module);
      if (spec.module.endsWith(".py") && fs.existsSync(file)) return createHash("sha256").update(fs.readFileSync(file)).update(variant).digest("hex");
      const py = Bun.spawnSync([spec.python ?? "python3", "--version"]).stdout.toString().trim();
      return cacheKey({ kind: "python", module: spec.module, fn: spec.fn ?? "handler", py, variant });
    },
    run: (input, ctx) => run(input, ctx, ctx.prefix),
    resume: (prefix, input, ctx) => run(input, ctx, prefix),
    close: () => process_.close(),
  };
}

registerTargetKind("python", (id, spec) => pythonTarget(id, spec as PythonTargetSpec));
