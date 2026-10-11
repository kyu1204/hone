// Correction commands on an offline target: ablate rules, evolve the rules text, optimize between candidates.
import { defineConfig, type HoneConfig } from "../../src/index.ts"; // in your project: from "hone-eval"

const RULES = ["Answer with the number only.", "Round to the nearest integer.", "Never include units."];

// The "harness" is a rules text that steers a toy solver; each rule changes behaviour measurably.
function solver(rules: string) {
  const numberOnly = /number only/i.test(rules);
  const round = /round/i.test(rules);
  const noUnits = /never include units/i.test(rules);
  return (input: unknown): string => {
    const m = String(input).match(/(-?\d+(?:\.\d+)?)\s*(km|kg|m)?\s*\*\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return "unknown";
    let value = Number(m[1]) * Number(m[3]);
    if (round) value = Math.round(value);
    let out = String(value);
    if (!noUnits && m[2]) out += ` ${m[2]}`;
    if (!numberOnly) out = `The result is ${out}.`;
    return out;
  };
}

function withRules(c: HoneConfig, rules: string): HoneConfig {
  return { ...c, targets: { solver: { kind: "fn", fn: solver(rules), version: rules } } };
}

const base = defineConfig({
  targets: {},
  cases: "evals/*.yaml",
  trials: 1,
  scorers: [{ name: "exact", normalize: "trim" }],
  gates: { passAt1: { min: 1 } },
});

export default defineConfig({
  ...withRules(base, RULES.join(" ")),
  ablations: Object.fromEntries(RULES.map((r) => [r.split(" ").slice(0, 2).join("-").toLowerCase().replace(/\W/g, ""), (c: HoneConfig) => withRules(c, RULES.filter((x) => x !== r).join(" "))])),
  evolve: { seed: RULES.slice(0, 1).join(" "), apply: withRules },
  optimize: { "no-rounding": (c: HoneConfig) => withRules(c, [RULES[0]!, RULES[2]!].join(" ")), "no-units-rule": (c: HoneConfig) => withRules(c, [RULES[0]!, RULES[1]!].join(" ")) },
});
