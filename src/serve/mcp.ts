// Stdio MCP server (newline-delimited JSON-RPC 2.0): one code path per feature via the existing commands.
import { pickSibling, rankBranchPoints } from "../analysis/branchpoints";
import { clusterCommand } from "../cli/commands/cluster";
import { compareCommand, storeRoot } from "../cli/commands/compare";
import { explainCommand } from "../cli/commands/explain";
import { forkCommand } from "../cli/commands/fork";
import { guideCommand } from "../cli/commands/guide";
import { matrixCommand } from "../cli/commands/matrix";
import { type CommandIo, runCommand } from "../cli/commands/run";
import { sharpenCommand } from "../cli/commands/sharpen";
import { Store } from "../core/store";
import { VERSION } from "../index";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface McpServerOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  /** `false`: hone_sharpen never lets the model write rewrites, whatever the client asks: the client is the one proposing. */
  rewrites?: boolean;
}

export interface McpServer {
  /** Handle one line; returns the response line, or undefined for notifications. */
  handle(line: string): Promise<string | undefined>;
  tools(): { name: string; description: string; inputSchema: Record<string, unknown> }[];
}

class ToolError extends Error {}

const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);

export function createMcpServer(opts: McpServerOptions): McpServer {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});

  /** Run a command with a capturing io; non-zero exit becomes a tool error carrying stderr. */
  const exec = async (fn: (argv: string[], io: CommandIo) => Promise<number>, argv: string[]): Promise<string> => {
    let out = "";
    let err = "";
    const io: CommandIo = { cwd: opts.cwd, env, stdout: (s) => void (out += s), stderr: (s) => void (err += s) };
    const rc = await fn(argv, io);
    if (rc !== 0) throw new ToolError(err.trim() || `exit code ${rc}`);
    return out;
  };
  const json = (text: string): ToolResult => ({ content: [{ type: "text", text: text.trim() }] });

  const tools: ToolDef[] = [
    {
      name: "hone_test",
      description: "Evaluate: run every case against every target (optionally filtered) and return the run summary.",
      inputSchema: { type: "object", properties: { cases: { type: "array", items: { type: "string" }, description: "case ids or globs" }, targets: { type: "array", items: { type: "string" } }, trials: { type: "number" } } },
      call: async (a) => json(await exec(runCommand, ["--quiet", "--json", ...list(a.cases).flatMap((c) => ["--case", c]), ...list(a.targets).flatMap((t) => ["--target", t]), ...(num(a.trials) !== undefined ? ["--trials", String(a.trials)] : [])])),
    },
    {
      name: "hone_sharpen",
      description: "Run the improvement cycle: measure, find why cases fail, try every change under sharpen/ (and variants, and rewrites by a model), confirm the best one on held-out cases. Returns the result document; `message` is the account to report. budget 0 only diagnoses and writes the page named in `diagnosisPath`. rewrites false has only the changes under sharpen/ and the variants judged.",
      inputSchema: { type: "object", properties: { budget: { type: "number", description: "changes to try (default 6); 0 only diagnoses" }, until: { type: "number", description: "stop once this pass rate is reached, e.g. 0.9" }, maxCost: { type: "number", description: "stop when the system under test has cost this much (USD)" }, trials: { type: "number" }, rewrites: { type: "boolean", description: "false: the model writes no rewrite of its own (default true)" } } },
      call: async (a) => json(await exec(sharpenCommand, ["--quiet", "--json", ...(num(a.budget) !== undefined ? ["--budget", String(a.budget)] : []), ...(num(a.until) !== undefined ? ["--until", String(a.until)] : []), ...(num(a.maxCost) !== undefined ? ["--max-cost", String(a.maxCost)] : []), ...(num(a.trials) !== undefined ? ["--trials", String(a.trials)] : []), ...(a.rewrites === false || opts.rewrites === false ? ["--no-rewrites"] : [])])),
    },
    {
      name: "hone_guide",
      description: "How to use hone: the skill, or one topic of it (setup, cases, sharpening, results, steps, mcp). Read `sharpening` before writing a change file.",
      inputSchema: { type: "object", properties: { topic: { type: "string" } } },
      call: async (a) => json(await exec(guideCommand, str(a.topic) ? [str(a.topic)!] : [])),
    },
    {
      name: "hone_list_runs",
      description: "List stored runs, newest first.",
      inputSchema: { type: "object", properties: { limit: { type: "number" } } },
      call: async (a) => {
        const store = new Store(await storeRoot({ cwd: opts.cwd, env, stdout: () => {}, stderr: () => {} }));
        try {
          return json(JSON.stringify(store.listRuns(num(a.limit) ?? 20).map((r) => ({ id: r.id, createdAt: r.createdAt, targets: r.targets, cases: r.caseIds.length, summary: (r.summary as { totals?: unknown } | undefined)?.totals ?? r.summary ?? null }))));
        } finally {
          store.close();
        }
      },
    },
    {
      name: "hone_matrix",
      description: "Per-target solve rate, cost, tokens and significance bands for a run.",
      inputSchema: { type: "object", properties: { run: { type: "string" } } },
      call: async (a) => json(await exec(matrixCommand, ["--json", ...(str(a.run) ? ["--run", str(a.run)!] : [])])),
    },
    {
      name: "hone_compare",
      description: "Paired comparison of two targets over the same cases, with significance.",
      inputSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" }, run: { type: "string" } }, required: ["a", "b"] },
      call: async (a) => {
        if (!str(a.a) || !str(a.b)) throw new ToolError("a and b are required");
        return json(await exec(compareCommand, [str(a.a)!, str(a.b)!, "--json", ...(str(a.run) ? ["--run", str(a.run)!] : [])]));
      },
    },
    {
      name: "hone_explain",
      description: "One trial in full: verdict, scores, messages, spans, plus ranked fork candidates when it failed.",
      inputSchema: { type: "object", properties: { trialId: { type: "string" } }, required: ["trialId"] },
      call: async (a) => {
        const id = str(a.trialId);
        if (!id) throw new ToolError("trialId is required");
        const trial = JSON.parse(await exec(explainCommand, [id, "--json"])) as import("../core/types").Trial;
        const store = new Store(await storeRoot({ cwd: opts.cwd, env, stdout: () => {}, stderr: () => {} }));
        try {
          const sibling = pickSibling(trial, store.queryTrials({ runId: trial.runId, caseId: trial.trace.caseId, pass: true }));
          return json(JSON.stringify({ ...trial, forkCandidates: trial.pass === false ? rankBranchPoints(trial, sibling).slice(0, 3) : [] }));
        } finally {
          store.close();
        }
      },
    },
    {
      name: "hone_cluster",
      description: "Group the failed trials of a run into failure modes (induce=true names them with the LLM and classifies with Jev).",
      inputSchema: { type: "object", properties: { run: { type: "string" }, induce: { type: "boolean" } } },
      call: async (a) => json(await exec(clusterCommand, ["--json", ...(str(a.run) ? ["--run", str(a.run)!] : []), ...(a.induce === true ? ["--induce"] : [])])),
    },
    {
      name: "hone_fork",
      description: "Replace one message of a trial and re-run the target from that prefix; returns the forked trial and the divergence.",
      inputSchema: { type: "object", properties: { trialId: { type: "string" }, step: { type: "number" }, content: { type: "string" } }, required: ["trialId", "step", "content"] },
      call: async (a) => {
        if (!str(a.trialId) || num(a.step) === undefined || str(a.content) === undefined) throw new ToolError("trialId, step and content are required");
        return json(await exec(forkCommand, [str(a.trialId)!, "--step", String(a.step), "--content", str(a.content)!, "--json"]));
      },
    },
  ];
  const byName = new Map(tools.map((t) => [t.name, t]));

  const respond = (id: JsonRpcRequest["id"], result: unknown): string => JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result });
  const fail = (id: JsonRpcRequest["id"], code: number, message: string): string => JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  return {
    tools: () => tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    async handle(line) {
      if (line.trim() === "") return undefined;
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(line) as JsonRpcRequest;
      } catch {
        return fail(null, -32700, "parse error");
      }
      const { id, method, params = {} } = req;
      const notification = id === undefined;
      log(`${method ?? "?"}${notification ? " (notification)" : ""}`);
      if (typeof method !== "string") return notification ? undefined : fail(id, -32600, "invalid request");
      if (method.startsWith("notifications/")) return undefined;
      switch (method) {
        case "initialize":
          return respond(id, { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "hone", version: VERSION } });
        case "ping":
          return respond(id, {});
        case "tools/list":
          return respond(id, { tools: this.tools() });
        case "tools/call": {
          const name = str(params.name);
          const tool = name ? byName.get(name) : undefined;
          if (!tool) return fail(id, -32602, `unknown tool ${name ?? "(none)"}`);
          const args = typeof params.arguments === "object" && params.arguments !== null ? (params.arguments as Record<string, unknown>) : {};
          try {
            return respond(id, await tool.call(args));
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            log(`tool ${name} failed: ${message}`);
            return respond(id, { content: [{ type: "text", text: message }], isError: true } satisfies ToolResult);
          }
        }
        default:
          return fail(id, -32601, `method not found: ${method}`);
      }
    },
  };
}

/** Pump newline-delimited frames from `input` to `output` until the input ends. */
export async function serveStdio(server: McpServer, input: ReadableStream<Uint8Array>, write: (line: string) => void): Promise<void> {
  const reader = input.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const res = await server.handle(line);
      if (res !== undefined) write(`${res}\n`);
      nl = buf.indexOf("\n");
    }
  }
  if (buf.trim()) {
    const res = await server.handle(buf);
    if (res !== undefined) write(`${res}\n`);
  }
}
