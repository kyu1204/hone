import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bisect } from "./bisect";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" };
function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

/** Six commits: value.txt says "good" for the first three, "bad" afterwards. */
function repo(): { dir: string; shas: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-bisect-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  const shas: string[] = [];
  for (let i = 1; i <= 6; i++) {
    fs.writeFileSync(path.join(dir, "value.txt"), i <= 3 ? "good\n" : "bad\n");
    fs.writeFileSync(path.join(dir, "n.txt"), `${i}\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", `commit ${i}`);
    shas.push(git(dir, "rev-parse", "HEAD"));
  }
  return { dir, shas };
}

describe("bisect", () => {
  test("finds the first bad commit with a measure that reads the worktree, and cleans up", async () => {
    const { dir, shas } = repo();
    const measured: string[] = [];
    const result = await bisect({
      repo: dir,
      good: shas[0]!,
      bad: shas[5]!,
      measure: async (worktree, commit) => {
        measured.push(commit);
        const good = fs.readFileSync(path.join(worktree, "value.txt"), "utf8").trim() === "good";
        return { successes: good ? 5 : 0, n: 5 };
      },
    });
    expect(result.firstBad).toBe(shas[3]);
    expect(result.firstBadSubject).toBe("commit 4");
    expect(result.candidates).toEqual(shas.slice(1));
    expect(result.goodRate).toBe(1);
    expect(measured[0]).toBe(shas[0]);
    expect(measured[1]).toBe(shas[5]);
    // good + bad endpoints, then at most ceil(log2(5)) probes
    expect(measured.length).toBeLessThanOrEqual(2 + 3);
    expect(result.probes.every((p) => p.verdict !== "unsure")).toBe(true);
    expect(git(dir, "worktree", "list").split("\n")).toHaveLength(1);
  });

  test("an unsure probe gets extra rounds before the point estimate decides", async () => {
    const { dir, shas } = repo();
    let calls = 0;
    const result = await bisect({
      repo: dir,
      good: shas[0]!,
      bad: shas[5]!,
      threshold: 0.5,
      measure: async (worktree) => {
        calls++;
        const good = fs.readFileSync(path.join(worktree, "value.txt"), "utf8").trim() === "good";
        // tiny samples: intervals are wide, so the first round is unsure
        return { successes: good ? 2 : 0, n: 2 };
      },
    });
    expect(result.firstBad).toBe(shas[3]);
    expect(result.probes.some((p) => p.rounds > 1)).toBe(true);
    expect(calls).toBeGreaterThan(result.probes.length);
  });

  test("bad commit that is not actually worse reports no first bad commit", async () => {
    const { dir, shas } = repo();
    const result = await bisect({ repo: dir, good: shas[0]!, bad: shas[5]!, measure: async () => ({ successes: 5, n: 5 }) });
    expect(result.firstBad).toBeUndefined();
  });
});
