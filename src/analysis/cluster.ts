// Failure clustering: summarise failed trials, embed, k-means with cosine distance, TF-IDF top terms.
import type { Trial } from "../core/types";
import { cosine, type Embedder, embed, type EmbedMethod, tokens } from "../providers/embed";

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/** One paragraph a human or an embedder can read: error, failed scorer reasons, last assistant text, tools, flags. */
export function summarise(trial: Trial): string {
  const parts: string[] = [];
  if (trial.trace.error) parts.push(`error: ${trial.trace.error}`);
  for (const s of trial.scores) if (s.pass === false) parts.push(`${s.scorer}: ${s.reason ?? `value ${s.value}`}`);
  const last = [...trial.trace.messages].reverse().find((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim() !== "");
  if (last && typeof last.content === "string") parts.push(`assistant: ${clip(last.content.replace(/\s+/g, " "), 300)}`);
  const tools = [...new Set(trial.trace.messages.flatMap((m) => m.tool_calls?.map((c) => c.function.name) ?? []))];
  if (tools.length) parts.push(`tools: ${tools.join(" ")}`);
  // "cached" is hone's own bookkeeping; in a summary it reads as something the system did, and a model naming the failure says so
  const flags = trial.flags.filter((f) => f !== "cached");
  if (flags.length) parts.push(`flags: ${flags.join(" ")}`);
  if (parts.length === 0) parts.push(`output: ${clip(typeof trial.trace.output === "string" ? trial.trace.output : JSON.stringify(trial.trace.output ?? ""), 300)}`);
  return parts.join("\n");
}

export function chooseK(n: number): number {
  return Math.min(8, Math.max(1, Math.ceil(Math.sqrt(n / 2))));
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function mean(vectors: number[][]): number[] {
  const out = Array.from({ length: vectors[0]?.length ?? 0 }, () => 0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] = out[i]! + v[i]! / vectors.length;
  return out;
}

export interface KmeansResult {
  assignments: number[];
  centroids: number[][];
}

/** k-means++ seeding, cosine distance, `iterations` Lloyd steps or until stable. */
export function kmeans(vectors: number[][], k: number, opts: { seed?: number; iterations?: number } = {}): KmeansResult {
  const n = vectors.length;
  k = Math.min(k, n);
  if (k === 0) return { assignments: [], centroids: [] };
  const rand = rng(opts.seed ?? 1);
  const dist = (a: number[], b: number[]) => 1 - cosine(a, b);
  const centroids = [vectors[Math.floor(rand() * n)]!];
  while (centroids.length < k) {
    const d2 = vectors.map((v) => Math.min(...centroids.map((c) => dist(v, c))) ** 2);
    const total = d2.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= d2[i]!;
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    centroids.push(total === 0 ? vectors[centroids.length]! : vectors[pick]!);
  }
  let assignments = Array.from({ length: n }, () => 0);
  for (let it = 0; it < (opts.iterations ?? 30); it++) {
    const next = vectors.map((v) => {
      let best = 0;
      let bd = Infinity;
      centroids.forEach((c, j) => {
        const d = dist(v, c);
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      return best;
    });
    for (let j = 0; j < k; j++) {
      const members = vectors.filter((_, i) => next[i] === j);
      if (members.length) centroids[j] = mean(members);
    }
    const stable = next.every((a, i) => a === assignments[i]);
    assignments = next;
    if (stable && it > 0) break;
  }
  return { assignments, centroids };
}

/** Highest mean TF-IDF tokens of `members` against the whole corpus. */
export function topTerms(docs: string[][], members: number[], n = 5): string[] {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const score = new Map<string, number>();
  for (const i of members) {
    const d = docs[i]!;
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, c] of tf) score.set(t, (score.get(t) ?? 0) + (c / d.length) * Math.log((docs.length + 1) / (df.get(t)! + 1)) + 1e-9);
  }
  return [...score.entries()]
    .filter(([t]) => t.length > 2 && !/^\d+$/.test(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

export interface FailureCluster {
  id: string;
  size: number;
  trialIds: string[];
  representative: string;
  topTerms: string[];
  summaries: string[];
}

export interface ClusterOptions {
  embed?: Embedder;
  k?: number;
  seed?: number;
  env?: Record<string, string | undefined>;
}

export async function clusterFailures(trials: Trial[], opts: ClusterOptions = {}): Promise<{ clusters: FailureCluster[]; method: EmbedMethod }> {
  const failed = trials.filter((t) => t.pass === false);
  if (failed.length === 0) return { clusters: [], method: "hash" };
  const summaries = failed.map(summarise);
  const embedder: Embedder = opts.embed ?? ((texts) => embed(texts, { env: opts.env }));
  const { vectors, method } = await embedder(summaries);
  const k = opts.k ?? chooseK(failed.length);
  const { assignments, centroids } = kmeans(vectors, k, { seed: opts.seed });
  const docs = summaries.map(tokens);
  const clusters: FailureCluster[] = [];
  for (let j = 0; j < centroids.length; j++) {
    const members = assignments.flatMap((a, i) => (a === j ? [i] : []));
    if (members.length === 0) continue;
    const rep = members.reduce((best, i) => (cosine(vectors[i]!, centroids[j]!) > cosine(vectors[best]!, centroids[j]!) ? i : best), members[0]!);
    clusters.push({ id: `cluster-${clusters.length + 1}`, size: members.length, trialIds: members.map((i) => failed[i]!.id), representative: failed[rep]!.id, topTerms: topTerms(docs, members), summaries: members.map((i) => summaries[i]!) });
  }
  clusters.sort((a, b) => b.size - a.size);
  clusters.forEach((c, i) => (c.id = `cluster-${i + 1}`));
  return { clusters, method };
}
