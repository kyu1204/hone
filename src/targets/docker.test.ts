import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { dockerTarget, type Exec, parseReward, readTaskToml } from "./docker";
import type { RunContext } from "./target";

const ctx: RunContext = { runId: "r", caseId: "hello", trial: 0 };
const task = new URL("../../test/fixtures/tasks/hello", import.meta.url).pathname;
const hasDocker = Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

describe("docker target: pure parts", () => {
  test("task.toml timeouts and name are read", () => {
    const t = readTaskToml(path.join(task, "task.toml"));
    expect(t.name).toBe("hone/hello");
    expect(t.agentTimeoutSec).toBe(60);
    expect(t.verifierTimeoutSec).toBe(30);
    expect(t.buildTimeoutSec).toBe(300);
  });

  test("reward parsing: reward.txt number, reward.json object, nothing", () => {
    expect(parseReward("0.5\n", undefined)).toBe(0.5);
    expect(parseReward(undefined, '{"rewards":{"tests":1,"style":0}}')).toEqual({ tests: 1, style: 0 });
    expect(parseReward(undefined, undefined)).toBeNull();
  });

  test("command assembly with a fake exec: build, run, agent exec, verifier exec, reward read", async () => {
    const calls: string[][] = [];
    const exec: Exec = async (argv) => {
      calls.push(argv);
      if (argv[1] === "run") return { code: 0, stdout: "cid123\n", stderr: "" };
      if (argv[1] === "exec" && argv.includes("cat") && argv.join(" ").includes("reward.txt")) return { code: 0, stdout: "1\n", stderr: "" };
      if (argv[1] === "exec" && argv.join(" ").includes("reward.json")) return { code: 1, stdout: "", stderr: "no such file" };
      if (argv[1] === "exec" && argv.join(" ").includes("trajectory.json")) return { code: 1, stdout: "", stderr: "no such file" };
      return { code: 0, stdout: "ok\n", stderr: "" };
    };
    const t = dockerTarget("d", { kind: "docker", task, agentCommand: ["sh", "-c", "echo {instruction} > /app/hello.txt"] }, exec);
    const out = await t.run("ignored", ctx);
    expect(out.error).toBeUndefined();
    expect(out.output).toBe(1);
    expect(out.meta?.taskName).toBe("hone/hello");
    expect(calls[0]?.slice(0, 2)).toEqual(["docker", "build"]);
    expect(calls[1]?.slice(0, 2)).toEqual(["docker", "run"]);
    expect(calls[1]?.join(" ")).toContain("/tests:ro");
    const agent = calls.find((c) => c[1] === "exec" && c.join(" ").includes("hello.txt"));
    expect(agent?.join(" ")).toContain("Create a file at /app/hello.txt");
    const verifier = calls.find((c) => c[1] === "exec" && c.join(" ").includes("/tests/test.sh"));
    expect(verifier).toBeDefined();
    // Files under /logs are root-owned on Linux hosts, so the container cleans them before it is removed.
    const cleanup = calls.findIndex((c) => c[1] === "exec" && c.join(" ").includes("rm -rf /logs"));
    expect(cleanup).toBeGreaterThan(0);
    expect(calls.at(-1)?.slice(0, 3)).toEqual(["docker", "rm", "-f"]);
    expect(cleanup).toBeLessThan(calls.length - 1);
    expect(await t.version()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("missing docker binary is an error, not a throw", async () => {
    const t = dockerTarget("d", { kind: "docker", task, agentCommand: ["true"] }, async () => ({ code: 127, stdout: "", stderr: "docker: not found" }));
    const out = await t.run("x", ctx);
    expect(out.error).toMatch(/docker/);
  });
});

describe.skipIf(!hasDocker)("docker target: end to end", () => {
  test("hello task passes with a shell agent", async () => {
    const t = dockerTarget("d", { kind: "docker", task, agentCommand: ["sh", "-c", "printf 'Hello, world!' > /app/hello.txt"] });
    const out = await t.run("x", ctx);
    expect(out.error).toBeUndefined();
    expect(out.output).toBe(1);
  }, 300_000);
});
