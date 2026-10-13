import { ConfigNotFound, loadConfig } from "../../core/config";
import { createScorers } from "../../scorers/index";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const SERVE_SPEC = { flags: ["read-only"], strings: ["run", "host"], numbers: ["port"], repeatable: [] } as const;
const HELP: Record<string, string> = { "read-only": "disable forks for connected viewers (default on)", run: "pin a run id instead of following the latest", host: "bind address (default 127.0.0.1; use 0.0.0.0 to share)", port: "port (default 2222)" };
export const REWARD_SPEC = { flags: [], strings: ["host", "scorer"], numbers: ["port"], repeatable: ["scorer"] } as const;
const REWARD_HELP: Record<string, string> = { host: "bind address (default 127.0.0.1)", port: "port (default 8787)", scorer: "scorer name to serve (repeatable; default all configured)" };

export function serveUsage(): string {
  return `usage: hone serve ssh [--port 2222] [--host 127.0.0.1] [--run id] [--read-only]\n       hone serve reward [--port 8787] [--host 127.0.0.1] [--scorer name]...\n       hone serve mcp [--no-rewrites]\n\nssh serves the dashboard (connect: ssh -p <port> <host>); reward serves the configured scorers over HTTP (GET /health, POST /score, POST /batch); mcp speaks MCP over stdio for agents (tools: hone_test, hone_sharpen, hone_guide, hone_list_runs, hone_matrix, hone_compare, hone_explain, hone_cluster, hone_fork); with --no-rewrites its hone_sharpen judges only the changes under sharpen/ and the variants, for a client that does the proposing.\n\nssh options:\n${usageLine(SERVE_SPEC, HELP)}\nreward options:\n${usageLine(REWARD_SPEC, REWARD_HELP)}\n`;
}

export interface ServeDeps {
  /** false returns right after the server starts (tests); default blocks until SIGINT/SIGTERM. */
  block?: boolean;
  started?: (stop: () => Promise<void>, info: { port: number; host: string }) => void;
  /** MCP input stream (tests); default process stdin. */
  stdin?: ReadableStream<Uint8Array>;
}

async function waitForSignal(stop: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => {
    const onSignal = () => {
      void stop().then(resolve);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

export async function serveCommand(argv: string[], io: CommandIo, deps: ServeDeps = {}): Promise<number> {
  const [mode, ...rest] = argv;
  if (mode === "--help" || mode === "-h" || mode === undefined) {
    (mode ? io.stdout : io.stderr)(serveUsage());
    return mode ? 0 : 2;
  }
  if (mode === "ssh") return serveSsh(rest, io, deps);
  if (mode === "reward") return serveReward(rest, io, deps);
  if (mode === "mcp") return serveMcp(rest, io, deps);
  io.stderr(`unknown serve mode "${mode}"; modes: ssh, reward, mcp\n${serveUsage()}`);
  return 2;
}

async function serveSsh(rest: string[], io: CommandIo, deps: ServeDeps): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(rest, SERVE_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${serveUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(serveUsage());
    return 0;
  }
  const { startSshServer } = await import("../../serve/ssh");
  const host = args.values.host?.[0] ?? "127.0.0.1";
  const server = await startSshServer({ port: args.numbers.port ?? 2222, host, storeRoot: await storeRoot(io), runId: args.values.run?.[0], readOnly: args.flags["read-only"] !== false, log: (l) => io.stderr(`${l}\n`) });
  io.stdout(`hone dashboard on ssh://${server.host}:${server.port}\n  connect: ssh -p ${server.port} ${host === "0.0.0.0" ? "<this-host>" : server.host}\n  fingerprint: ${server.fingerprints.join(", ")}\n  ctrl+c stops the server\n`);
  deps.started?.(() => server.stop(), { port: server.port, host: server.host });
  if (deps.block !== false) await waitForSignal(() => server.stop());
  return 0;
}

async function serveReward(rest: string[], io: CommandIo, deps: ServeDeps): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(rest, REWARD_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${serveUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(serveUsage());
    return 0;
  }
  let config;
  try {
    config = (await loadConfig(io.cwd)).config;
  } catch (e) {
    io.stderr(`${e instanceof ConfigNotFound ? e.message : `config error: ${e instanceof Error ? e.message : String(e)}`}\n`);
    return 2;
  }
  const all = createScorers(config.scorers);
  const wanted = args.values.scorer ?? [];
  const scorers = wanted.length ? wanted.map((n) => all.find((s) => s.name === n)) : all;
  const missing = wanted.filter((_, i) => !scorers[i]);
  if (missing.length) {
    io.stderr(`scorer ${missing.join(", ")} not found; configured: ${all.map((s) => s.name).join(", ") || "(none)"}\n`);
    return 2;
  }
  const { startRewardServer } = await import("../../serve/reward");
  const server = await startRewardServer({ scorers: scorers as NonNullable<(typeof scorers)[number]>[], port: args.numbers.port ?? 8787, host: args.values.host?.[0] ?? "127.0.0.1", log: (l) => io.stderr(`${l}\n`) });
  io.stdout(`hone reward server on http://${server.host}:${server.port}\n  scorers: ${(scorers as NonNullable<(typeof scorers)[number]>[]).map((s) => s.name).join(", ")}\n  POST /score {messages|output, case?}   POST /batch {items: [...]}   GET /health\n  ctrl+c stops the server\n`);
  deps.started?.(server.stop, { port: server.port, host: server.host });
  if (deps.block !== false) await waitForSignal(server.stop);
  return 0;
}

async function serveMcp(rest: string[], io: CommandIo, deps: ServeDeps): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    io.stdout(serveUsage());
    return 0;
  }
  const noRewrites = rest.includes("--no-rewrites");
  if (rest.some((a) => a !== "--no-rewrites")) {
    io.stderr(`hone serve mcp takes one option, --no-rewrites\n${serveUsage()}`);
    return 2;
  }
  const { createMcpServer, serveStdio } = await import("../../serve/mcp");
  const server = createMcpServer({ cwd: io.cwd, env: io.env, log: (l) => io.stderr(`mcp: ${l}\n`), ...(noRewrites ? { rewrites: false } : {}) });
  const input = deps.stdin ?? (Bun.stdin.stream() as ReadableStream<Uint8Array>);
  // protocol frames go to stdout only; io.stdout may be a test capture
  await serveStdio(server, input, (line) => io.stdout(line));
  return 0;
}
