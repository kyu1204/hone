// The simplest loop: a function under test, exact/contains scorers, a consistency check, a gate.
import { defineConfig } from "../../src/index.ts"; // in your project: from "hone-eval"

const FACTS: Record<string, string> = { "capital of france": "Paris", "largest planet": "Jupiter", "boiling point of water in celsius": "100" };

// Tolerant of rephrasing and noise: looks for a known fact or an arithmetic expression anywhere in the question.
function answer(question: string): string {
  const q = question.toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  for (const [key, value] of Object.entries(FACTS)) if (q.includes(key)) return value;
  const m = q.match(/(-?\d+)\s*([+*-])\s*(-?\d+)/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[3])];
    return String(m[2] === "+" ? a + b : m[2] === "-" ? a - b : a * b);
  }
  return "I don't know";
}

export default defineConfig({
  targets: {
    qa: { kind: "fn", fn: (input: unknown) => answer(String(input)), version: "qa-v1" },
  },
  cases: "evals/*.yaml",
  trials: 2,
  scorers: [
    { name: "exact", normalize: "trim lower" },
    { name: "consistency", mutations: ["paraphrase", "noise"], n: 1 },
  ],
  gates: { passAt1: { min: 0.9 } },
});
