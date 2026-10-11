import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../test/fixtures/trace.valid.json";
import { Store } from "../core/store";
import type { Trace } from "../core/types";
import { ensureHostKey, startSshServer } from "./ssh";

const base = valid as Trace;
const dirs: string[] = [];
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const s of stops.splice(0)) await s();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const hasSsh = Bun.spawnSync(["ssh", "-V"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

function fixture(): { root: string; runId: string; home: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-ssh-"));
  dirs.push(root);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hone-ssh-home-"));
  dirs.push(home);
  const store = new Store(path.join(root, ".hone"));
  const run = store.createRun({ configHash: "h", targets: ["rag"], caseIds: ["alpha"] });
  store.saveTrial({ id: Store.trialId(run.id, "alpha", "rag", 0), runId: run.id, trace: { ...base, id: "a", caseId: "alpha", targetId: "rag", trial: 0 }, scores: [], flags: [], pass: true, costUsd: 0.01 });
  store.finishRun(run.id, {});
  store.close();
  return { root, runId: run.id, home };
}

describe("ensureHostKey", () => {
  test("generates a key once under the config dir with mode 600", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "hone-key-"));
    dirs.push(home);
    const a = ensureHostKey(home);
    const b = ensureHostKey(home);
    expect(a).toBe(b);
    expect(fs.existsSync(a)).toBe(true);
    expect((fs.statSync(a).mode & 0o777).toString(8)).toBe("600");
    expect(fs.readFileSync(a, "utf8")).toContain("PRIVATE KEY");
  });
});

describe.skipIf(!hasSsh)("ssh server", () => {
  test("serves the dashboard to an ssh client; the frame shows the run id", async () => {
    const { root, runId, home } = fixture();
    const server = await startSshServer({ port: 0, home, storeRoot: path.join(root, ".hone"), readOnly: true });
    stops.push(() => server.stop());
    expect(server.port).toBeGreaterThan(0);
    const proc = Bun.spawn(
      ["ssh", "-tt", "-p", String(server.port), "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=5", "demo@127.0.0.1"],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, TERM: "xterm-256color" } },
    );
    let out = "";
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !out.includes(runId.slice(0, 10))) {
      const { value, done } = await Promise.race([reader.read(), Bun.sleep(300).then(() => ({ value: undefined, done: false }))]);
      if (done) break;
      if (value) out += decoder.decode(value, { stream: true });
    }
    (proc.stdin as import("bun").FileSink).write("q");
    (proc.stdin as import("bun").FileSink).flush();
    await Promise.race([proc.exited, Bun.sleep(2000)]);
    proc.kill();
    expect(out).toContain(runId.slice(0, 10));
    expect(server.connections()).toBeGreaterThanOrEqual(1);
  }, 20_000);
});
