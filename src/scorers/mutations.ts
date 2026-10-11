// Meaning-preserving input mutations for the consistency scorer. Pure and deterministic.

export const MUTATIONS = ["paraphrase", "reorder", "noise"] as const;
export type MutationName = (typeof MUTATIONS)[number];

const PARAPHRASE_RULES: [RegExp, string][] = [
  [/^what is\s+(.+?)\?$/i, "Tell me $1."],
  [/^what are\s+(.+?)\?$/i, "Tell me $1."],
  [/^tell me\s+(.+?)\.?$/i, "What is $1?"],
  [/^when does\s+(.+?)\?$/i, "At what time does $1?"],
  [/^how do i\s+(.+?)\?$/i, "What is the way to $1?"],
  [/^why\s+(.+?)\?$/i, "What is the reason that $1?"],
];
const SYNONYMS: [RegExp, string][] = [
  [/\bbegin(s)?\b/gi, "start$1"],
  [/\bstart(s)?\b/gi, "begin$1"],
  [/\bbig\b/gi, "large"],
  [/\bfast\b/gi, "quick"],
  [/\bcan't\b/gi, "cannot"],
  [/\bdon't\b/gi, "do not"],
];
const NOISE = [
  "By the way, the weather is mild today.",
  "Unrelated: my favourite colour is green.",
  "Note: this message was typed on a laptop.",
  "Also, lunch was good.",
];

function paraphrase(s: string, index: number): string {
  const t = s.trim();
  if (index % 2 === 0) {
    for (const [re, rep] of PARAPHRASE_RULES) if (re.test(t)) return t.replace(re, rep);
    return `Please answer: ${t}`;
  }
  let out = t;
  for (const [re, rep] of SYNONYMS) out = out.replace(re, rep);
  if (out === t) out = t.endsWith("?") ? `Could you tell me ${t.charAt(0).toLowerCase()}${t.slice(1, -1)}?` : `${t} Answer concisely.`;
  return out;
}

/** Undefined when the input has a single clause: sending it unchanged would not test anything. */
function reorder(s: string, index: number): string | undefined {
  const parts = s.split(/;\s+|,\s+and\s+|\n+/).filter((p) => p.trim() !== "");
  if (parts.length < 2) return undefined;
  const k = (index % (parts.length - 1)) + 1;
  return [...parts.slice(k), ...parts.slice(0, k)].join("; ");
}

export function mutate(name: MutationName, input: unknown, index: number): unknown {
  if (typeof input === "string") {
    if (name === "paraphrase") return paraphrase(input, index);
    if (name === "reorder") return reorder(input, index);
    return `${input} ${NOISE[index % NOISE.length]}`;
  }
  if (name === "noise" && typeof input === "object" && input !== null && !Array.isArray(input)) return { ...(input as Record<string, unknown>), _irrelevant: NOISE[index % NOISE.length] };
  return undefined;
}
