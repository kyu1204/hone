// Text embeddings: OpenAI-compatible /embeddings when a key is configured, otherwise a hashed bag of words.
import { type EnvSources, lookupEnv } from "./jev";

export const HASH_DIM = 512;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_.-]+/g) ?? [];
}

/** 512-dim hashed unigrams + bigrams, L2-normalised; empty text is the zero vector. */
export function hashEmbed(texts: string[]): number[][] {
  return texts.map((text) => {
    const v = Array.from({ length: HASH_DIM }, () => 0);
    const toks = tokens(text);
    const grams = [...toks, ...toks.slice(1).map((t, i) => `${toks[i]} ${t}`)];
    for (const g of grams) {
      const h = fnv1a(g);
      v[h % HASH_DIM] = v[h % HASH_DIM]! + ((h >>> 16) & 1 ? 1 : -1);
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return norm === 0 ? v : v.map((x) => x / norm);
  });
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export type EmbedMethod = "openai" | "hash";
export interface EmbedResult {
  vectors: number[][];
  method: EmbedMethod;
  model?: string;
}
export type Embedder = (texts: string[]) => Promise<EmbedResult>;

export interface EmbedOptions {
  env?: Record<string, string | undefined>;
  src?: EnvSources;
  fetch?: typeof fetch;
}

export const offlineEmbed: Embedder = async (texts) => ({ vectors: hashEmbed(texts), method: "hash" });

export async function embed(texts: string[], opts: EmbedOptions = {}): Promise<EmbedResult> {
  const get = (n: string) => lookupEnv(n, opts.env ?? process.env, opts.src);
  const key = get("OPENAI_API_KEY");
  if (!key || texts.length === 0) return offlineEmbed(texts);
  const base = (get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = get("HONE_EMBED_MODEL") ?? "text-embedding-3-small";
  const vectors: number[][] = Array.from({ length: texts.length }, () => []);
  for (let i = 0; i < texts.length; i += 256) {
    const batch = texts.slice(i, i + 256);
    const res = await (opts.fetch ?? fetch)(`${base}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: batch, model }),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    for (const d of body.data) vectors[i + d.index] = d.embedding;
  }
  return { vectors, method: "openai", model };
}
