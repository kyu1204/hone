// pass@k and pass^k unbiased estimators (tau-bench, arXiv 2406.12045).
import type { Verdict } from "../core/types";
import { lgamma } from "./dist";
import { wilsonCi } from "./interval";

export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

function check(n: number, c: number, k: number): void {
  if (!Number.isInteger(n) || !Number.isInteger(c) || !Number.isInteger(k)) throw new RangeError("n, c, k must be integers");
  if (k < 1 || k > n) throw new RangeError(`k must be in 1..n, got k=${k}, n=${n}`);
  if (c < 0 || c > n) throw new RangeError("c must be in 0..n");
}

/** Probability that all k of k independent draws (without replacement) from n trials with c successes succeed. */
export function passHatK(n: number, c: number, k: number): number {
  check(n, c, k);
  if (k > c) return 0;
  return Math.exp(logChoose(c, k) - logChoose(n, k));
}

/** Probability that at least one of k draws succeeds. */
export function passAtK(n: number, c: number, k: number): number {
  check(n, c, k);
  if (k > n - c) return 1;
  return 1 - Math.exp(logChoose(n - c, k) - logChoose(n, k));
}

export function verdictFor(caseId: string, targetId: string, outcomes: boolean[], ks: number[] = [1, 2, 3, 5]): Verdict {
  const n = outcomes.length;
  const passes = outcomes.filter(Boolean).length;
  if (n === 0) return { caseId, targetId, n, passes, passAt1: 0, passHatK: {}, ci: [0, 1] };
  const passHat: Record<number, number> = {};
  for (const k of ks) if (k <= n) passHat[k] = passHatK(n, passes, k);
  const ci = wilsonCi(passes, n);
  return { caseId, targetId, n, passes, passAt1: passes / n, passHatK: passHat, ci: [ci.lo, ci.hi] };
}
