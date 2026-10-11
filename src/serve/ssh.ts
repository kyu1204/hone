// Serve the dashboard over SSH with @opentui/ssh: one renderer and one TUI store per session.
import { createRoot } from "@opentui/react";
import { createServer } from "@opentui/ssh";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createElement } from "react";
import { App } from "../tui/app";
import { createTuiStore, type ForkOptions } from "../tui/state";

/**
 * ~/.config/hone/ssh_host_key in OpenSSH format (what ssh2 parses), generated once with
 * ssh-keygen when available; otherwise @opentui/ssh generates it on first listen.
 */
export function ensureHostKey(home = os.homedir()): string {
  const dir = path.join(home, ".config", "hone");
  const file = path.join(dir, "ssh_host_key");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) {
    const r = Bun.spawnSync(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "hone", "-f", file], { stdout: "ignore", stderr: "ignore" });
    if (r.exitCode !== 0) return file; // let the library generate it
  }
  fs.chmodSync(file, 0o600);
  return file;
}

export interface SshServerOptions {
  port?: number;
  host?: string;
  home?: string;
  storeRoot: string;
  runId?: string;
  readOnly?: boolean;
  fork?: ForkOptions;
  log?: (line: string) => void;
}

export interface SshServerHandle {
  port: number;
  host: string;
  fingerprints: string[];
  connections(): number;
  stop(): Promise<void>;
}

export async function startSshServer(opts: SshServerOptions): Promise<SshServerHandle> {
  const hostKey = ensureHostKey(opts.home);
  let live = 0;
  let total = 0;
  const log = opts.log ?? (() => {});
  const server = createServer({ hostKey: { path: hostKey }, auth: "open", startupBanner: false, idleTimeout: "30m", onError: (err) => log(`ssh error: ${err instanceof Error ? err.message : String(err)}`) }).serve((session) => {
    live++;
    total++;
    const who = `${session.identity.username}@${session.remoteAddress?.address ?? "?"}`;
    log(`connected ${who} (${live} live)`);
    const store = createTuiStore({ root: opts.storeRoot, runId: opts.runId, watch: true, readOnly: opts.readOnly ?? true, fork: opts.readOnly === false ? opts.fork : undefined });
    const root = createRoot(session.renderer);
    root.render(createElement(App, { store, onQuit: () => session.renderer.destroy() }));
    session.onClose(() => {
      live--;
      store.dispose();
      root.unmount();
      log(`disconnected ${who} (${live} live)`);
    });
  });
  const info = await server.listen(opts.port ?? 2222, opts.host ?? "127.0.0.1");
  return {
    port: info.port,
    host: info.host,
    fingerprints: info.fingerprints,
    connections: () => total,
    stop: () => server.close(),
  };
}
