// Paired comparison of two targets over the same cases (Miller 2024, arXiv 2411.00640).
import { clusterRobustSe } from "./cluster";
import { lgamma, tForConfidence, tTwoSidedP } from "./dist";
import { mean, stdev } from "./interval";

export interface PairedResult {
  n: number;
  meanDiff: number;
  se: number;
  t: number;
  p: number;
  lo: number;
  hi: number;
  corr: number;
  /** 1 - paired variance / unpaired variance of the difference. */
  varianceReduction: number;
  confidence: number;
}

export function pairedDifference(a: number[], b: number[], confidence = 0.95): PairedResult {
  if (a.length !== b.length) throw new RangeError("a and b must have the same length");
  const n = a.length;
  if (n < 2) throw new RangeError("need at least two pairs");
  const d = a.map((x, i) => x - b[i]!);
  const md = mean(d);
  const sd = stdev(d);
  const se = sd / Math.sqrt(n);
  const t = se === 0 ? (md === 0 ? 0 : Number.POSITIVE_INFINITY) : md / se;
  const p = se === 0 ? (md === 0 ? 1 : 0) : tTwoSidedP(t, n - 1);
  const tc = tForConfidence(confidence, n - 1);
  const ma = mean(a);
  const mb = mean(b);
  const sa = stdev(a);
  const sb = stdev(b);
  const cov = a.reduce((acc, x, i) => acc + (x - ma) * (b[i]! - mb), 0) / (n - 1);
  const corr = sa === 0 || sb === 0 ? 0 : cov / (sa * sb);
  const unpairedVar = (sa * sa + sb * sb) / n;
  const pairedVar = (sd * sd) / n;
  const varianceReduction = unpairedVar === 0 ? (pairedVar === 0 ? 1 : 0) : 1 - pairedVar / unpairedVar;
  return { n, meanDiff: md, se, t, p, lo: md - tc * se, hi: md + tc * se, corr, varianceReduction, confidence };
}

/** Exact two-sided McNemar test on discordant pairs b (a wins) and c (b wins). */
export function mcnemarExact(b: number, c: number): { p: number; b: number; c: number } {
  const n = b + c;
  if (n === 0) return { p: 1, b, c };
  const k = Math.min(b, c);
  let cdf = 0;
  for (let i = 0; i <= k; i++) cdf += Math.exp(lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) - n * Math.LN2);
  return { p: Math.min(1, 2 * cdf), b, c };
}

export interface CompareRow {
  caseId: string;
  a: number;
  b: number;
  cluster?: string;
}

export interface CompareResult {
  paired: PairedResult;
  mcnemar?: { p: number; b: number; c: number };
  clustered?: { se: number; nClusters: number; lo: number; hi: number };
}

const isBinary = (xs: number[]): boolean => xs.every((x) => x === 0 || x === 1);

export function compareTargets(rows: CompareRow[], confidence = 0.95): CompareResult {
  const a = rows.map((r) => r.a);
  const b = rows.map((r) => r.b);
  const paired = pairedDifference(a, b, confidence);
  const out: CompareResult = { paired };
  if (isBinary(a) && isBinary(b)) {
    const bWins = rows.filter((r) => r.a === 1 && r.b === 0).length;
    const cWins = rows.filter((r) => r.a === 0 && r.b === 1).length;
    out.mcnemar = mcnemarExact(bWins, cWins);
  }
  if (rows.every((r) => r.cluster !== undefined)) {
    const diffs = rows.map((r) => r.a - r.b);
    const clusters = rows.map((r) => r.cluster!);
    const nClusters = new Set(clusters).size;
    const se = clusterRobustSe(diffs, clusters);
    const tc = tForConfidence(confidence, Math.max(1, nClusters - 1));
    out.clustered = { se, nClusters, lo: paired.meanDiff - tc * se, hi: paired.meanDiff + tc * se };
  }
  return out;
}
