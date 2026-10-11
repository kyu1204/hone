import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TargetSpec } from "../core/config";
import { cacheKey } from "../core/cache";
import type { ChatMessage, Span } from "../core/types";
import { type AtifTrajectory, atifToMessages } from "../io/atif";
import { registerTargetKind, type RunContext, type Target, type TargetOutput } from "./target";

export interface DockerTargetSpec extends TargetSpec {
  kind: "docker";
  /** Harbor-style task directory: task.toml, instruction.md, environment/Dockerfile, tests/test.sh */
  task: string;
  /** Runs inside the container. Placeholders: {instruction} {instruction_path} */
  agentCommand: string[];
  timeoutMs?: number;
  buildTimeoutMs?: number;
  keep?: boolean;
}

export type ExecResult = { code: number; stdout: string; stderr: string };
export type Exec = (argv: string[], opts?: { timeoutMs?: number }) => Promise<ExecResult>;

export const defaultExec: Exec = async (argv, opts = {}) => {
  try {
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timer = opts.timeoutMs ? setTimeout(() => proc.kill("SIGKILL"), opts.timeoutMs) : undefined;
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (timer) clearTimeout(timer);
    return { code, stdout, stderr };
  } catch (e) {
    return { code: 127, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
  }
};

export interface TaskToml {
  name: string;
  agentTimeoutSec?: number;
  verifierTimeoutSec?: number;
  buildTimeoutSec?: number;
}

/** Reads the few keys hone needs from task.toml without a TOML dependency. */
export function readTaskToml(file: string): TaskToml {
  const out: TaskToml = { name: path.basename(path.dirname(file)) };
  if (!fs.existsSync(file)) return out;
  let section = "";
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) {
      section = sec[1]!;
      continue;
    }
    const kv = /^([A-Za-z_]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!.trim();
    const num = Number(value);
    const str = value.startsWith('"') ? value.slice(1, -1) : value;
    if (section === "task" && key === "name") out.name = str;
    if (section === "agent" && key === "timeout_sec" && Number.isFinite(num)) out.agentTimeoutSec = num;
    if (section === "verifier" && key === "timeout_sec" && Number.isFinite(num)) out.verifierTimeoutSec = num;
    if (section === "environment" && key === "build_timeout_sec" && Number.isFinite(num)) out.buildTimeoutSec = num;
  }
  return out;
}

export function parseReward(txt: string | undefined, json: string | undefined): number | Record<string, number> | null {
  if (json) {
    try {
      const parsed = JSON.parse(json) as { rewards?: Record<string, number> } | Record<string, number>;
      return (parsed as { rewards?: Record<string, number> }).rewards ?? (parsed as Record<string, number>);
    } catch {
      // fall through to txt
    }
  }
  if (txt !== undefined) {
    const n = Number(txt.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hashDir(dir: string): string[][] {
  const out: string[][] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push([path.relative(dir, p), cacheKey(fs.readFileSync(p).toString("base64"))]);
    }
  };
  walk(dir);
  return out;
}

export function dockerTarget(id: string, spec: DockerTargetSpec, exec: Exec = defaultExec): Target {
  const task = path.resolve(spec.task);
  const tomlPath = path.join(task, "task.toml");
  const instructionPath = path.join(task, "instruction.md");

  const run = async (_input: unknown, _ctx: RunContext): Promise<TargetOutput> => {
    const toml = readTaskToml(tomlPath);
    const instruction = fs.existsSync(instructionPath) ? fs.readFileSync(instructionPath, "utf8") : "";
    const agentTimeoutMs = spec.timeoutMs ?? (toml.agentTimeoutSec ?? 1800) * 1000;
    const buildTimeoutMs = spec.buildTimeoutMs ?? (toml.buildTimeoutSec ?? 600) * 1000;
    const verifierTimeoutMs = (toml.verifierTimeoutSec ?? 300) * 1000;
    const tag = `hone-task-${cacheKey(hashDir(path.join(task, "environment"))).slice(0, 12)}`;
    const startedAt = new Date().toISOString();

    const build = await exec(["docker", "build", "-t", tag, path.join(task, "environment")], { timeoutMs: buildTimeoutMs });
    if (build.code === 127) return { output: null, error: `docker not available: ${build.stderr.trim()}` };
    if (build.code !== 0) return { output: null, error: `docker build failed: ${build.stderr.trim().slice(0, 500)}`, artifacts: { stdout: build.stdout, stderr: build.stderr } };

    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-logs-"));
    const runRes = await exec([
      "docker", "run", "-d",
      "-v", `${path.join(task, "tests")}:/tests:ro`,
      "-v", `${logsDir}:/logs`,
      ...(fs.existsSync(instructionPath) ? ["-v", `${instructionPath}:/instruction.md:ro`] : []),
      tag, "sleep", "infinity",
    ]);
    if (runRes.code !== 0) return { output: null, error: `docker run failed: ${runRes.stderr.trim().slice(0, 500)}` };
    const cid = runRes.stdout.trim();
    const dexec = (argv: string[], timeoutMs: number) => exec(["docker", "exec", cid, ...argv], { timeoutMs });

    try {
      const argv = spec.agentCommand.map((a) => a.replaceAll("{instruction_path}", "/instruction.md").replaceAll("{instruction}", instruction.trim()));
      const agent = await dexec(argv, agentTimeoutMs);
      const verifier = await dexec(["sh", "/tests/test.sh"], verifierTimeoutMs);
      const txt = await dexec(["cat", "/logs/verifier/reward.txt"], 10_000);
      const json = await dexec(["cat", "/logs/verifier/reward.json"], 10_000);
      const traj = await dexec(["cat", "/logs/agent/trajectory.json"], 10_000);
      const reward = parseReward(txt.code === 0 ? txt.stdout : undefined, json.code === 0 ? json.stdout : undefined);
      const endedAt = new Date().toISOString();

      let messages: ChatMessage[] = [{ role: "user", content: instruction }];
      let spans: Span[] = [];
      const meta: Record<string, unknown> = { taskName: toml.name, image: tag, container: cid };
      if (traj.code === 0) {
        try {
          const mapped = atifToMessages(JSON.parse(traj.stdout) as AtifTrajectory);
          messages = mapped.messages;
          spans = mapped.spans;
          Object.assign(meta, mapped.meta);
        } catch {
          meta.trajectoryError = "unparseable trajectory.json";
        }
      }
      spans.unshift({ id: "agent", kind: "agent", name: "docker", startedAt, endedAt, input: instruction, output: reward, attrs: { agentExit: agent.code, verifierExit: verifier.code } });
      const out: TargetOutput = {
        output: reward,
        messages,
        spans,
        artifacts: { stdout: `${agent.stdout}${verifier.stdout}`, stderr: `${agent.stderr}${verifier.stderr}` },
        meta,
      };
      if (agent.code !== 0) out.error = `agent command exited with code ${agent.code}`;
      else if (reward === null) out.error = "verifier wrote no reward";
      return out;
    } finally {
      if (!spec.keep) await exec(["docker", "rm", "-f", cid]);
      fs.rmSync(logsDir, { recursive: true, force: true });
    }
  };

  return {
    id,
    kind: "docker",
    async version() {
      const files = ["task.toml", "instruction.md"].filter((f) => fs.existsSync(path.join(task, f))).map((f) => [f, cacheKey(fs.readFileSync(path.join(task, f), "utf8"))]);
      const dirs = ["environment", "tests"].filter((d) => fs.existsSync(path.join(task, d))).flatMap((d) => hashDir(path.join(task, d)).map(([p, h]) => [`${d}/${p}`, h]));
      return cacheKey({ kind: "docker", files, dirs, agentCommand: spec.agentCommand });
    },
    run,
  };
}

registerTargetKind("docker", (id, spec) => dockerTarget(id, spec as DockerTargetSpec));
