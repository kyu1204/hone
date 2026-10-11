// Git bisection with confidence intervals: a commit is "bad" only when its Wilson interval
// sits below the threshold, "good" only when above; unsure probes get more rounds.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { wilsonCi } from "../stats/interval";

export interface Measurement {
  successes: number;
  n: number;
}

export interface BisectOptions {
  repo: string;
  good: string;
  bad: string;
  /** Run the evaluation inside a checked-out worktree of `commit`. Called once per round. */
  measure: (worktree: string, commit: string) => Promise<Measurement>;
  /** Pass rate below which a commit is bad. Default: midpoint between the good and bad endpoint rates. */
  threshold?: number;
  maxRounds?: number;
  log?: (line: string) => void;
}

export interface Probe {
  commit: string;
  subject: string;
  successes: number;
  n: number;
  passAt1: number;
  lo: number;
  hi: number;
  verdict: "good" | "bad" | "unsure";
  rounds: number;
}

export interface BisectResult {
  firstBad?: string;
  firstBadSubject?: string;
  candidates: string[];
  probes: Probe[];
  goodRate: number;
  badRate: number;
  threshold: number;
}

function git(cwd: string, args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
}

async function withWorktree<T>(repo: string, commit: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-bisect-wt-"));
  fs.rmSync(dir, { recursive: true, force: true });
  git(repo, ["worktree", "add", "--detach", "-q", dir, commit]);
  try {
    return await fn(dir);
  } finally {
    try {
      git(repo, ["worktree", "remove", "--force", dir]);
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
      try {
        git(repo, ["worktree", "prune"]);
      } catch {
        // nothing left to prune
      }
    }
  }
}

export async function bisect(opts: BisectOptions): Promise<BisectResult> {
  const maxRounds = opts.maxRounds ?? 3;
  const log = opts.log ?? (() => {});
  const candidates = git(opts.repo, ["rev-list", "--reverse", `${opts.good}..${opts.bad}`]).split("\n").filter(Boolean);
  const subject = (c: string): string => git(opts.repo, ["log", "-1", "--format=%s", c]);
  const probes: Probe[] = [];

  const probe = async (commit: string, decide: (lo: number, hi: number, p: number, rounds: number) => Probe["verdict"]): Promise<Probe> => {
    let successes = 0;
    let n = 0;
    let rounds = 0;
    let verdict: Probe["verdict"] = "unsure";
    let lo = 0;
    let hi = 1;
    while (rounds < maxRounds && verdict === "unsure") {
      const m = await withWorktree(opts.repo, commit, (dir) => opts.measure(dir, commit));
      successes += m.successes;
      n += m.n;
      rounds++;
      if (n === 0) break;
      const ci = wilsonCi(successes, n);
      lo = ci.lo;
      hi = ci.hi;
      verdict = decide(lo, hi, successes / n, rounds);
    }
    const p: Probe = { commit, subject: subject(commit), successes, n, passAt1: n ? successes / n : 0, lo, hi, verdict, rounds };
    probes.push(p);
    log(`${commit.slice(0, 8)} ${p.subject}: ${p.passAt1.toFixed(2)} [${lo.toFixed(2)}, ${hi.toFixed(2)}] ${verdict} after ${rounds} round(s)`);
    return p;
  };

  // Endpoints first. The threshold sits halfway between the two rates unless given, and the
  // bad endpoint must really be worse than the good one before any search starts.
  const goodProbe = await probe(opts.good, () => "good");
  const goodRate = goodProbe.passAt1;
  const badSample = await withWorktree(opts.repo, opts.bad, (dir) => opts.measure(dir, opts.bad));
  const badRate = badSample.n ? badSample.successes / badSample.n : 0;
  const threshold = opts.threshold ?? (goodRate + badRate) / 2;
  const isBad = (lo: number, hi: number, p: number, rounds: number): Probe["verdict"] => (hi < threshold ? "bad" : lo > threshold ? "good" : rounds >= maxRounds ? (p < threshold ? "bad" : "good") : "unsure");
  const result: BisectResult = { candidates, probes, goodRate, badRate, threshold };
  const badCi = badSample.n ? wilsonCi(badSample.successes, badSample.n) : { lo: 0, hi: 1 };
  probes.push({ commit: opts.bad, subject: subject(opts.bad), successes: badSample.successes, n: badSample.n, passAt1: badRate, lo: badCi.lo, hi: badCi.hi, verdict: badRate < threshold ? "bad" : "good", rounds: 1 });
  if (badRate >= goodRate || candidates.length === 0) return result;

  // Binary search over candidates[0..n-2]; the last candidate is the known-bad endpoint.
  let lo = 0;
  let hi = candidates.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const p = await probe(candidates[mid]!, isBad);
    if (p.verdict === "bad") hi = mid;
    else lo = mid + 1;
  }
  result.firstBad = candidates[lo];
  result.firstBadSubject = subject(candidates[lo]!);
  return result;
}
