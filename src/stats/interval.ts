import { mulberry32, zForConfidence } from "./dist";

export interface MeanEstimate {
  mean: number;
  se: number;
  lo: number;
  hi: number;
  confidence: number;
  method: "wilson" | "clt" | "bootstrap";
  n: number;
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (ddof = 1). */
export function stdev(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

/** Wilson score interval for a binomial proportion (Wilson 1927). */
export function wilsonCi(successes: number, n: number, confidence = 0.95): MeanEstimate {
  if (n <= 0) throw new RangeError("n must be positive");
  if (successes < 0 || successes > n) throw new RangeError("successes must be between 0 and n");
  const z = zForConfidence(confidence);
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const se = p > 0 && p < 1 ? Math.sqrt((p * (1 - p)) / n) : Math.sqrt(z2) / (2 * n);
  return { mean: p, se, lo: center - half, hi: center + half, confidence, method: "wilson", n };
}

/** Normal-approximation interval around a sample mean. */
export function meanCiClt(values: number[], confidence = 0.95): MeanEstimate {
  const n = values.length;
  if (n < 2) throw new RangeError("need at least two values");
  const m = mean(values);
  const se = stdev(values) / Math.sqrt(n);
  const z = zForConfidence(confidence);
  return { mean: m, se, lo: m - z * se, hi: m + z * se, confidence, method: "clt", n };
}

/** Percentile bootstrap of the mean with a seeded PRNG. */
export function bootstrapCi(values: number[], opts: { confidence?: number; nBoot?: number; seed?: number } = {}): MeanEstimate {
  const n = values.length;
  if (n < 2) throw new RangeError("need at least two values");
  const confidence = opts.confidence ?? 0.95;
  const nBoot = opts.nBoot ?? 2000;
  const rand = mulberry32(opts.seed ?? 0);
  const means = Array.from({ length: nBoot }, () => 0);
  for (let b = 0; b < nBoot; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)]!;
    means[b] = s / n;
  }
  means.sort((a, b) => a - b);
  const q = (p: number) => means[Math.min(nBoot - 1, Math.max(0, Math.floor(p * (nBoot - 1))))]!;
  const alpha = (1 - confidence) / 2;
  return { mean: mean(values), se: stdev(means), lo: q(alpha), hi: q(1 - alpha), confidence, method: "bootstrap", n };
}
