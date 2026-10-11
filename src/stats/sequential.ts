// Sequential stopping on Wilson interval width, for adaptive trial allocation.
import { wilsonCi } from "./interval";

export interface StopInput {
  successes: number;
  n: number;
  minTrials?: number;
  maxTrials: number;
  ciWidth: number;
  confidence?: number;
}

export function intervalWidth(successes: number, n: number, confidence = 0.95): number {
  if (n === 0) return 1;
  const ci = wilsonCi(successes, n, confidence);
  return ci.hi - ci.lo;
}

export function shouldStop(input: StopInput): { stop: boolean; reason?: "ci-width" | "max-trials"; width: number } {
  const minTrials = input.minTrials ?? 2;
  const width = intervalWidth(input.successes, input.n, input.confidence);
  if (input.n >= input.maxTrials) return { stop: true, reason: "max-trials", width };
  if (input.n >= minTrials && width <= input.ciWidth) return { stop: true, reason: "ci-width", width };
  return { stop: false, width };
}

export interface Cell {
  key: string;
  successes: number;
  n: number;
  maxTrials: number;
}

/** The runnable cell with the widest interval (ties: fewer trials), or undefined when all have stopped. */
export function nextCell<T extends Cell>(cells: T[], ciWidth: number, opts: { minTrials?: number; confidence?: number } = {}): T | undefined {
  let best: T | undefined;
  let bestWidth = -1;
  for (const c of cells) {
    const s = shouldStop({ successes: c.successes, n: c.n, maxTrials: c.maxTrials, ciWidth, minTrials: opts.minTrials, confidence: opts.confidence });
    if (s.stop) continue;
    if (s.width > bestWidth || (s.width === bestWidth && best && c.n < best.n)) {
      best = c;
      bestWidth = s.width;
    }
  }
  return best;
}
