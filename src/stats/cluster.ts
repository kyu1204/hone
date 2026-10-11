// Cluster-robust SE (CR1), intraclass correlation, Kish design effect, within/between
// variance. Formulas mirror errorbars 0.2.4 so the fixture vectors match exactly.
import { mean } from "./interval";

function groupBy(values: number[], keys: (string | number)[]): number[][] {
  const map = new Map<string | number, number[]>();
  keys.forEach((k, i) => {
    const g = map.get(k);
    if (g) g.push(values[i]!);
    else map.set(k, [values[i]!]);
  });
  return [...map.values()];
}

/** One-way random-effects ANOVA ICC with Kish's unequal-size correction. */
export function intraclassCorrelation(values: number[], clusters: (string | number)[]): number {
  const groups = groupBy(values, clusters);
  const g = groups.length;
  const n = values.length;
  if (g <= 1 || g === n) return 0;
  const grand = mean(values);
  const ssb = groups.reduce((a, grp) => a + grp.length * (mean(grp) - grand) ** 2, 0);
  const ssw = groups.reduce((a, grp) => {
    const m = mean(grp);
    return a + grp.reduce((x, v) => x + (v - m) ** 2, 0);
  }, 0);
  const msb = ssb / (g - 1);
  const dofW = n - g;
  if (dofW <= 0) return 0;
  const msw = ssw / dofW;
  const k0 = (n - groups.reduce((a, grp) => a + grp.length ** 2, 0) / n) / (g - 1);
  if (msw === 0 && msb === 0) return 0;
  const denom = msb + (k0 - 1) * msw;
  if (denom === 0) return 0;
  return Math.min(1, Math.max(-1, (msb - msw) / denom));
}

export function designEffect(icc: number, avgClusterSize: number): number {
  return 1 + (avgClusterSize - 1) * icc;
}

/** CR1 sandwich SE of the sample mean, statsmodels cov_type="cluster" equivalent. */
export function clusterRobustSe(values: number[], clusters: (string | number)[]): number {
  const n = values.length;
  const m = mean(values);
  const resid = values.map((v) => v - m);
  const groups = groupBy(resid, clusters);
  const g = groups.length;
  if (g <= 1) return Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / (n * (n - 1)));
  const meat = groups.reduce((a, grp) => a + grp.reduce((x, y) => x + y, 0) ** 2, 0);
  const variance = (meat / (n * n)) * (g / (g - 1));
  return Math.sqrt(Math.max(variance, 0));
}

/** [within, between] variance across repeated samples per question. */
export function withinBetweenVariance(values: number[], questionIds: (string | number)[]): [number, number] {
  const groups = groupBy(values, questionIds);
  const q = groups.length;
  const n = values.length;
  const multi = groups.filter((grp) => grp.length > 1);
  const withinDof = multi.reduce((a, grp) => a + grp.length - 1, 0);
  const withinSum = multi.reduce((a, grp) => {
    const m = mean(grp);
    return a + grp.reduce((x, v) => x + (v - m) ** 2, 0);
  }, 0);
  const within = withinDof > 0 ? withinSum / withinDof : 0;
  if (q <= 1) return [within, 0];
  const grand = mean(values);
  const msb = groups.reduce((a, grp) => a + grp.length * (mean(grp) - grand) ** 2, 0) / (q - 1);
  const k0 = (n - groups.reduce((a, grp) => a + grp.length ** 2, 0) / n) / (q - 1);
  const between = k0 > 0 ? Math.max(0, (msb - within) / k0) : Math.max(0, msb);
  return [within, between];
}
