// Two-parameter logistic IRT by joint MAP gradient ascent: targets are examinees, cases are items.
export interface IrtRow {
  targetId: string;
  caseId: string;
  pass: boolean;
}

export interface IrtItem {
  difficulty: number;
  discrimination: number;
}

export interface IrtFit {
  targets: Record<string, { ability: number }>;
  cases: Record<string, IrtItem>;
  logLik: number;
}

interface Cell {
  t: number;
  c: number;
  y: number; // mean pass
  n: number; // trials
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

function cells(rows: IrtRow[]): { cells: Cell[]; targets: string[]; cases: string[] } {
  const tIdx = new Map<string, number>();
  const cIdx = new Map<string, number>();
  const acc = new Map<string, { t: number; c: number; sum: number; n: number }>();
  for (const r of rows) {
    if (!tIdx.has(r.targetId)) tIdx.set(r.targetId, tIdx.size);
    if (!cIdx.has(r.caseId)) cIdx.set(r.caseId, cIdx.size);
    const key = `${r.targetId}\u0000${r.caseId}`;
    const cell = acc.get(key) ?? { t: tIdx.get(r.targetId)!, c: cIdx.get(r.caseId)!, sum: 0, n: 0 };
    cell.sum += r.pass ? 1 : 0;
    cell.n++;
    acc.set(key, cell);
  }
  return { cells: [...acc.values()].map((x) => ({ t: x.t, c: x.c, y: x.sum / x.n, n: x.n })), targets: [...tIdx.keys()], cases: [...cIdx.keys()] };
}

export function fit2pl(rows: IrtRow[], opts: { iterations?: number; lr?: number; prior?: number } = {}): IrtFit {
  const iterations = opts.iterations ?? 300;
  const lr = opts.lr ?? 0.3;
  const prior = opts.prior ?? 1;
  const { cells: cs, targets, cases: items } = cells(rows);
  const theta = new Float64Array(targets.length);
  const b = new Float64Array(items.length);
  const la = new Float64Array(items.length); // log discrimination, starts at 0 (a = 1)
  const nT = new Float64Array(targets.length);
  const nC = new Float64Array(items.length);
  for (const c of cs) {
    nT[c.t] = nT[c.t]! + c.n;
    nC[c.c] = nC[c.c]! + c.n;
  }
  const gT = new Float64Array(targets.length);
  const gB = new Float64Array(items.length);
  const gA = new Float64Array(items.length);
  let logLik = 0;
  for (let it = 0; it < iterations; it++) {
    gT.fill(0);
    gB.fill(0);
    gA.fill(0);
    logLik = 0;
    for (const c of cs) {
      const a = Math.exp(la[c.c]!);
      const z = a * (theta[c.t]! - b[c.c]!);
      const p = sigmoid(z);
      const resid = c.y - p;
      gT[c.t] = gT[c.t]! + c.n * a * resid;
      gB[c.c] = gB[c.c]! - c.n * a * resid;
      gA[c.c] = gA[c.c]! + c.n * resid * z; // d/d(log a): resid * a * (theta - b) = resid * z
      logLik += c.n * (c.y * Math.log(p + 1e-12) + (1 - c.y) * Math.log(1 - p + 1e-12));
    }
    for (let t = 0; t < theta.length; t++) theta[t] = theta[t]! + lr * ((gT[t]! - theta[t]! / (prior * prior)) / Math.max(1, nT[t]!));
    for (let i = 0; i < b.length; i++) {
      b[i] = b[i]! + lr * ((gB[i]! - b[i]! / (prior * prior)) / Math.max(1, nC[i]!));
      la[i] = la[i]! + lr * ((gA[i]! - la[i]!) / Math.max(1, nC[i]!));
      la[i] = Math.min(Math.log(5), Math.max(Math.log(0.05), la[i]!));
    }
    // identifiability: centre abilities
    const meanTheta = theta.reduce((x, y) => x + y, 0) / theta.length;
    for (let t = 0; t < theta.length; t++) theta[t] = theta[t]! - meanTheta;
    for (let i = 0; i < b.length; i++) b[i] = b[i]! - meanTheta;
  }
  return {
    targets: Object.fromEntries(targets.map((id, i) => [id, { ability: theta[i]! }])),
    cases: Object.fromEntries(items.map((id, i) => [id, { difficulty: b[i]!, discrimination: Math.exp(la[i]!) }])),
    logLik,
  };
}

export function fisherInformation(ability: number, item: IrtItem): number {
  const p = sigmoid(item.discrimination * (ability - item.difficulty));
  return item.discrimination * item.discrimination * p * (1 - p);
}

export function orderCasesByInformation(fit: IrtFit, targetId: string): string[] {
  const ability = fit.targets[targetId]?.ability ?? 0;
  return Object.entries(fit.cases)
    .map(([id, item]) => [id, fisherInformation(ability, item)] as const)
    .sort((x, y) => y[1] - x[1])
    .map(([id]) => id);
}

export interface CaseNoise {
  noise: number;
  cells: number;
  regressionOnly: boolean;
}

/** Per case: mean within-cell Bernoulli variance, and whether it only guards against regressions. */
export function caseNoise(rows: IrtRow[], items: Record<string, IrtItem> = {}): Record<string, CaseNoise> {
  const { cells: cs, cases: ids } = cells(rows);
  const out: Record<string, CaseNoise> = {};
  ids.forEach((id, ci) => {
    const mine = cs.filter((c) => c.c === ci);
    const noise = mine.reduce((a, c) => a + c.y * (1 - c.y), 0) / Math.max(1, mine.length);
    const allPass = mine.every((c) => c.y === 1);
    const allFail = mine.every((c) => c.y === 0);
    const disc = items[id]?.discrimination ?? 1;
    out[id] = { noise, cells: mine.length, regressionOnly: disc < 0.2 && (allPass || allFail) };
  });
  return out;
}
