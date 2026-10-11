// Beta-Bernoulli Thompson sampling for allocating trials among candidate variants.
import { mulberry32 } from "./dist";

/** Marsaglia-Tsang gamma sampler (shape >= 1 with the shape < 1 boost). */
function gammaSample(rand: () => number, shape: number): number {
  if (shape < 1) return gammaSample(rand, shape + 1) * rand() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = 1 - rand();
      const u2 = rand();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(rand: () => number, a: number, b: number): number {
  const x = gammaSample(rand, a);
  const y = gammaSample(rand, b);
  return x / (x + y);
}

export class BetaBandit {
  private readonly params = new Map<string, { alpha: number; beta: number }>();
  private readonly rand: () => number;

  constructor(arms: string[], seed = 0) {
    if (arms.length === 0) throw new RangeError("need at least one arm");
    for (const a of arms) this.params.set(a, { alpha: 1, beta: 1 });
    this.rand = mulberry32(seed);
  }

  arms(): string[] {
    return [...this.params.keys()];
  }

  update(arm: string, success: boolean): void {
    const p = this.params.get(arm);
    if (!p) throw new RangeError(`unknown arm ${arm}`);
    if (success) p.alpha++;
    else p.beta++;
  }

  posterior(arm: string): { alpha: number; beta: number; mean: number } {
    const p = this.params.get(arm);
    if (!p) throw new RangeError(`unknown arm ${arm}`);
    return { ...p, mean: p.alpha / (p.alpha + p.beta) };
  }

  /** Thompson sample: draw from each posterior, return the arm with the largest draw. */
  sample(): string {
    let best = "";
    let bestDraw = -1;
    for (const [arm, p] of this.params) {
      const draw = betaSample(this.rand, p.alpha, p.beta);
      if (draw > bestDraw) {
        best = arm;
        bestDraw = draw;
      }
    }
    return best;
  }

  best(): string {
    let best = "";
    let bestMean = -1;
    for (const arm of this.params.keys()) {
      const m = this.posterior(arm).mean;
      if (m > bestMean) {
        best = arm;
        bestMean = m;
      }
    }
    return best;
  }
}

/** Draw `budget` arms by Thompson sampling without updating; returns counts per arm. */
export function allocate(bandit: BetaBandit, budget: number): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(bandit.arms().map((a) => [a, 0]));
  for (let i = 0; i < budget; i++) counts[bandit.sample()]!++;
  return counts;
}
