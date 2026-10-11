import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const SERVE_SPEC = { flags: ["read-only"], strings: ["run", "host"], numbers: ["port"], repeatable: [] } as const;
const HELP: Record<string, string> = { "read-only": "disable forks for connected viewers (default on)", run: "pin a run id instead of following the latest", host: "bind address (default 127.0.0.1; use 0.0.0.0 to share)", port: "port (default 2222)" };

export function serveUsage(): string {
  return `usage: hone serve ssh [--port 2222] [--host 127.0.0.1] [--run id] [--read-only]\n\nServe the dashboard over SSH. Connect with: ssh -p <port> <host>\n\n${usageLine(SERVE_SPEC, HELP)}\n`;
}

export async function serveCommand(argv: string[], io: CommandIo): Promise<number> {
  const [mode, ...rest] = argv;
  if (mode !== "ssh") {
    io.stderr(`${mode ? `unknown serve mode "${mode}"; ` : ""}only \`hone serve ssh\` exists in this version (mcp and reward arrive with P7)\n${serveUsage()}`);
    return mode === "--help" || mode === "-h" ? 0 : 2;
  }
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
  await new Promise<void>((resolve) => {
    const stop = () => {
      void server.stop().then(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
