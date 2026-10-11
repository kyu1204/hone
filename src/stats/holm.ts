// Holm-Bonferroni step-down and leaderboard groups of indistinguishable targets.
import { mean } from "./interval";
import { pairedDifference } from "./paired";

export function holm(pValues: number[], alpha = 0.05): { adjusted: number[]; reject: boolean[] } {
  const m = pValues.length;
  if (m === 0) return { adjusted: [], reject: [] };
  const order = pValues.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const adjusted = Array.from({ length: m }, () => 0);
  let running = 0;
  order.forEach(([p, idx], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    adjusted[idx] = running;
  });
  return { adjusted, reject: adjusted.map((a) => a <= alpha) };
}

export interface Leaderboard {
  order: string[];
  pairwise: { a: string; b: string; p: number; adjusted: number; significant: boolean }[];
  groups: string[][];
}

/** Maximal cliques (Bron-Kerbosch) of an undirected graph given as adjacency sets. */
function maximalCliques(nodes: string[], adj: Map<string, Set<string>>): string[][] {
  const out: string[][] = [];
  const bk = (r: string[], p: Set<string>, x: Set<string>): void => {
    if (p.size === 0 && x.size === 0) {
      out.push(r);
      return;
    }
    // p is mutated inside the loop, so iterate over a snapshot
    for (const v of Array.from(p)) {
      const nv = adj.get(v)!;
      bk([...r, v], new Set([...p].filter((u) => nv.has(u))), new Set([...x].filter((u) => nv.has(u))));
      p.delete(v);
      x.add(v);
    }
  };
  bk([], new Set(nodes), new Set());
  return out;
}

export function leaderboard(scores: Record<string, number[]>, alpha = 0.05): Leaderboard {
  const ids = Object.keys(scores);
  const means = Object.fromEntries(ids.map((id) => [id, mean(scores[id]!)]));
  const order = [...ids].sort((a, b) => means[b]! - means[a]!);
  const pairs: { a: string; b: string; p: number }[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push({ a: ids[i]!, b: ids[j]!, p: pairedDifference(scores[ids[i]!]!, scores[ids[j]!]!).p });
  const { adjusted, reject } = holm(pairs.map((p) => p.p), alpha);
  const pairwise = pairs.map((p, i) => ({ ...p, adjusted: adjusted[i]!, significant: reject[i]! }));
  const adj = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const p of pairwise) {
    if (!p.significant) {
      adj.get(p.a)!.add(p.b);
      adj.get(p.b)!.add(p.a);
    }
  }
  const groups = maximalCliques(order, adj)
    .map((g) => [...g].sort((a, b) => means[b]! - means[a]!))
    .sort((g1, g2) => means[g2[0]!]! - means[g1[0]!]!);
  return { order, pairwise, groups };
}
