// Power analysis for the two-sided paired t test (statsmodels TTestPower equivalent).
// Noncentral t CDF by Lenth's AS 243 series over regularized incomplete beta terms.
import { lgamma, normalCdf, regularizedIncompleteBeta, tForConfidence } from "./dist";

export function noncentralTCdf(t: number, dof: number, delta: number): number {
  if (t < 0) return 1 - noncentralTCdf(-t, dof, -delta);
  if (t === 0) return normalCdf(-delta);
  const x = (t * t) / (t * t + dof);
  const lambda = delta * delta;
  const halfLambda = lambda / 2;
  let sum = 0;
  let logPoisson = -halfLambda; // log( e^{-λ/2} (λ/2)^j / j! ) at j = 0
  for (let j = 0; j < 1000; j++) {
    if (j > 0) logPoisson += Math.log(halfLambda) - Math.log(j);
    const pj = Math.exp(logPoisson);
    const qj = lambda === 0 ? 0 : Math.sign(delta) * Math.exp(logPoisson + Math.log(Math.abs(delta)) - 0.5 * Math.LN2 + lgamma(j + 1) - lgamma(j + 1.5));
    const term = pj * regularizedIncompleteBeta(j + 0.5, dof / 2, x) + qj * regularizedIncompleteBeta(j + 1, dof / 2, x);
    sum += term;
    if (j > halfLambda + 10 && Math.abs(term) < 1e-15) break;
  }
  return Math.min(1, Math.max(0, normalCdf(-delta) + 0.5 * sum));
}

/** Power of a two-sided paired t test with n pairs and standardized effect d. */
export function pairedPower({ n, effect, alpha = 0.05 }: { n: number; effect: number; alpha?: number }): number {
  const dof = n - 1;
  const tc = tForConfidence(1 - alpha, dof);
  const delta = effect * Math.sqrt(n);
  return 1 - noncentralTCdf(tc, dof, delta) + noncentralTCdf(-tc, dof, delta);
}

function bisect(f: (x: number) => number, lo: number, hi: number, iters = 100): number {
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Pairs needed for a given effect, alpha and power (continuous n, like statsmodels). */
export function pairedPowerN({ effect, alpha = 0.05, power = 0.8 }: { effect: number; alpha?: number; power?: number }): number {
  if (effect <= 0) throw new RangeError("effect must be positive");
  return bisect((n) => pairedPower({ n, effect, alpha }) - power, 2, 1e6);
}

/** Minimum detectable standardized effect for n pairs. */
export function pairedMde({ n, alpha = 0.05, power = 0.8 }: { n: number; alpha?: number; power?: number }): number {
  return bisect((d) => pairedPower({ n, effect: d, alpha }) - power, 1e-4, 20);
}

/**
 * Adjust a required n for the design: pairing correlation shrinks the difference variance by
 * (1 - corr); repeats divide the decoding-noise share by the repeat count; clusters multiply
 * by Kish's design effect.
 */
export function withDesign(n: number, opts: { pairingCorr?: number; repeats?: number; noiseShare?: number; icc?: number; avgClusterSize?: number }): number {
  let out = n;
  if (opts.pairingCorr !== undefined) out *= 1 - opts.pairingCorr;
  if (opts.repeats !== undefined && opts.repeats > 1) {
    const share = opts.noiseShare ?? 1;
    out *= 1 - share + share / opts.repeats;
  }
  if (opts.icc !== undefined && opts.avgClusterSize !== undefined) out *= 1 + (opts.avgClusterSize - 1) * opts.icc;
  return out;
}
