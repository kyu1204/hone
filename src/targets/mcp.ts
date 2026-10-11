import type { TargetSpec } from "../core/config";
import { cacheKey } from "../core/cache";
import { VERSION } from "../index";
import { registerTargetKind, type RunContext, type Target, type TargetOutput } from "./target";

export interface McpTargetSpec extends TargetSpec {
  kind: "mcp";
  command: string[];
  tool: string;
  args?: (input: unknown) => Record<string, unknown>;
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

interface RpcResponse {
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolResult {
  content?: { type: string; text?: string; [k: string]: unknown }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Tiny newline-delimited JSON-RPC client over a child process. */
class McpProcess {
  private proc: ReturnType<typeof Bun.spawn> | undefined;
  private pending = new Map<number, { resolve: (r: RpcResponse) => void }>();
  private seq = 0;
  private init: Promise<unknown> | undefined;
  serverInfo: unknown;

  constructor(private readonly spec: McpTargetSpec) {}

  private exitError(code: number | null): RpcResponse {
    return { error: { code: -1, message: `mcp server exited with code ${String(code)}` } };
  }

  private start(): void {
    const proc = Bun.spawn(this.spec.command, { cwd: this.spec.cwd, env: { ...process.env, ...this.spec.env }, stdin: "pipe", stdout: "pipe", stderr: "inherit" });
    this.proc = proc;
    void this.readLines(proc);
    void proc.exited.then((code) => {
      if (this.proc === proc) {
        this.proc = undefined;
        this.init = undefined;
      }
      for (const [id, p] of this.pending) {
        this.pending.delete(id);
        p.resolve(this.exitError(code));
      }
    });
  }

  private async readLines(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
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
        if (!line.startsWith("{")) continue;
        let msg: RpcResponse;
        try {
          msg = JSON.parse(line) as RpcResponse;
        } catch {
          continue;
        }
        if (typeof msg.id === "number") {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p.resolve(msg);
          }
        }
      }
    }
  }

  private send(obj: Record<string, unknown>): void {
    const sink = this.proc?.stdin as import("bun").FileSink | undefined;
    sink?.write(`${JSON.stringify(obj)}\n`);
    sink?.flush();
  }

  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<RpcResponse> {
    if (!this.proc) return Promise.resolve(this.exitError(null));
    const id = ++this.seq;
    const proc = this.proc;
    const res = new Promise<RpcResponse>((resolve) => this.pending.set(id, { resolve }));
    this.send({ jsonrpc: "2.0", id, method, params });
    const timeout = new Promise<RpcResponse>((resolve) =>
      setTimeout(() => {
        if (this.pending.delete(id)) {
          proc.kill();
          resolve({ error: { code: -2, message: `mcp ${method} timed out after ${timeoutMs}ms` } });
        }
      }, timeoutMs),
    );
    return Promise.race([res, timeout]);
  }

  /** Spawn and handshake if needed; resolves to an error response when the handshake fails. */
  ensure(timeoutMs: number): Promise<RpcResponse | undefined> {
    if (!this.proc) {
      this.start();
      this.init = undefined;
    }
    this.init ??= (async () => {
      const r = await this.request("initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "hone", version: VERSION } }, timeoutMs);
      if (r.error) return r;
      this.serverInfo = (r.result as { serverInfo?: unknown } | undefined)?.serverInfo;
      this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return undefined;
    })();
    return this.init as Promise<RpcResponse | undefined>;
  }

  async close(): Promise<void> {
    const proc = this.proc;
    this.proc = undefined;
    this.init = undefined;
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

function mapResult(r: ToolResult): { output: unknown; text: string } {
  const content = r.content ?? [];
  const allText = content.length > 0 && content.every((c) => c.type === "text");
  const text = allText ? content.map((c) => c.text ?? "").join("\n") : JSON.stringify(content);
  if (r.structuredContent !== undefined) return { output: r.structuredContent, text };
  if (!allText) return { output: content, text };
  try {
    return { output: JSON.parse(text), text };
  } catch {
    return { output: text, text };
  }
}

export function mcpTarget(id: string, spec: McpTargetSpec): Target {
  const timeoutMs = spec.timeoutMs ?? 60_000;
  const proc = new McpProcess(spec);

  const run = async (input: unknown, ctx: RunContext): Promise<TargetOutput> => {
    const args = spec.args ? spec.args(input) : typeof input === "object" && input !== null ? (input as Record<string, unknown>) : { input };
    const startedAt = new Date().toISOString();
    const initErr = await proc.ensure(timeoutMs);
    if (initErr?.error) return { output: null, error: `mcp: ${initErr.error.message}` };
    const r = await proc.request("tools/call", { name: spec.tool, arguments: args }, timeoutMs);
    const endedAt = new Date().toISOString();
    const span = { id: "tool", kind: "tool" as const, name: spec.tool, startedAt, endedAt, input: args, output: r.result ?? r.error };
    const messages: TargetOutput["messages"] = [{ role: "user", content: JSON.stringify(args) }];
    if (r.error) return { output: null, error: `mcp: ${r.error.message}`, spans: [span], messages };
    const { output, text } = mapResult((r.result ?? {}) as ToolResult);
    messages.push({ role: "tool", tool_call_id: `${spec.tool}-${ctx.trial}`, name: spec.tool, content: text });
    const out: TargetOutput = { output, spans: [span], messages };
    if ((r.result as ToolResult).isError) out.error = `mcp tool ${spec.tool} returned isError: ${text.slice(0, 300)}`;
    return out;
  };

  return {
    id,
    kind: "mcp",
    async version() {
      await proc.ensure(timeoutMs);
      return cacheKey({ kind: "mcp", command: spec.command, tool: spec.tool, serverInfo: proc.serverInfo ?? null });
    },
    run,
    close: () => proc.close(),
  };
}

registerTargetKind("mcp", (id, spec) => mcpTarget(id, spec as McpTargetSpec));
