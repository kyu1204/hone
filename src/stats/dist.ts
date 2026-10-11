// Distribution helpers, dependency-free. Formulas mirror errorbars 0.2.4 (stats.py) so the
// fixture vectors match: regularized incomplete beta by modified Lentz continued fraction,
// Student t p-values through it, t quantiles by bisection.

const LANCZOS = [0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-06, 1.5056327351493116e-07];

/** log Gamma(x) for x > 0 (Lanczos, g = 7). */
export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  d = 1 / (Math.abs(d) > tiny ? d : tiny);
  let h = d;
  for (let m = 1; m < 1000; m++) {
    const m2 = 2 * m;
    const even = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    const odd = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    for (const aa of [even, odd]) {
      d = 1 + aa * d;
      d = 1 / (Math.abs(d) > tiny ? d : tiny);
      c = 1 + aa / c;
      c = Math.abs(c) > tiny ? c : tiny;
      h *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-15) break;
  }
  return h;
}

/** I_x(a, b) for a, b > 0. */
export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a;
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** P(a, x): regularized lower incomplete gamma (series and continued fraction, NR 6.2). */
export function regularizedLowerGamma(a: number, x: number): number {
  if (x <= 0) return 0;
  const gln = lgamma(a);
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
}

export function normalCdf(x: number): number {
  const p = regularizedLowerGamma(0.5, (x * x) / 2);
  return x >= 0 ? 0.5 * (1 + p) : 0.5 * (1 - p);
}

/** Wichura AS241 (PPND16): inverse normal CDF accurate to about 1e-16. */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`p must be in (0, 1), got ${p}`);
  const q = p - 0.5;
  let r: number;
  if (Math.abs(q) <= 0.425) {
    r = 0.180625 - q * q;
    return (
      (q *
        (((((((r * 2509.0809287301227 + 33430.57558358813) * r + 67265.7709270087) * r + 45921.95393154987) * r + 13731.69376550946) * r + 1971.5909503065513) * r + 133.14166789178438) * r + 3.3871328727963665)) /
      (((((((r * 5226.495278852546 + 28729.085735721943) * r + 39307.89580009271) * r + 21213.794301586597) * r + 5394.196021424751) * r + 687.1870074920579) * r + 42.31333070160091) * r + 1)
    );
  }
  r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let val: number;
  if (r <= 5) {
    r -= 1.6;
    val =
      (((((((r * 0.0007745450142783414 + 0.022723844989269184) * r + 0.2417807251774506) * r + 1.2704582524523684) * r + 3.6478483247632045) * r + 5.769497221460691) * r + 4.630337846156546) * r + 1.4234371107496835) /
      (((((((r * 1.0507500716444169e-09 + 0.0005475938084995345) * r + 0.015198666563616457) * r + 0.14810397642748008) * r + 0.6897673349851) * r + 1.6763848301838038) * r + 2.053191626637759) * r + 1);
  } else {
    r -= 5;
    val =
      (((((((r * 2.0103343992922881e-07 + 2.7115555687434876e-05) * r + 0.0012426609473880784) * r + 0.026532189526576124) * r + 0.29656057182850487) * r + 1.7848265399172913) * r + 5.463784911164114) * r + 6.657904643501103) /
      (((((((r * 2.0442631033899397e-15 + 1.421511758316446e-07) * r + 1.8463183175100548e-05) * r + 0.0007868691311456133) * r + 0.014875361290850615) * r + 0.1369298809227358) * r + 0.599832206555888) * r + 1);
  }
  return q < 0 ? -val : val;
}

export function zForConfidence(confidence: number): number {
  if (!(confidence > 0 && confidence < 1)) throw new RangeError(`confidence must be in (0, 1), got ${confidence}`);
  return normalQuantile(0.5 + confidence / 2);
}

/** P(|T| >= |t|) for Student t with `dof` degrees of freedom. */
export function tTwoSidedP(t: number, dof: number): number {
  if (dof <= 0) throw new RangeError("degrees of freedom must be positive");
  if (!Number.isFinite(t)) return 0;
  return regularizedIncompleteBeta(dof / 2, 0.5, dof / (dof + t * t));
}

/** Two-sided Student t critical value by bisection on tTwoSidedP. */
export function tForConfidence(confidence: number, dof: number): number {
  if (!(confidence > 0 && confidence < 1)) throw new RangeError(`confidence must be in (0, 1), got ${confidence}`);
  const alpha = 1 - confidence;
  let lo = 0;
  let hi = Math.max(10, zForConfidence(confidence) * 4);
  while (tTwoSidedP(hi, dof) > alpha) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, dof) > alpha) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

/** Small seeded PRNG (mulberry32) for reproducible bootstrap and sampling. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
