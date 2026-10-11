// Metamorphic consistency: the target should answer perturbed inputs the same way.
import type { ScorerSpec } from "../core/config";
import { JevClient, noul } from "../providers/jev";
import { MUTATIONS, type MutationName, mutate } from "./mutations";
import { registerScorerKind, type Scorer } from "./scorer";

export interface ConsistencySpec extends ScorerSpec {
  mutations?: MutationName[];
  n?: number;
  compare?: "exact" | "jev";
  jevThreshold?: number;
  client?: JevClient;
}

const norm = (x: unknown): string => (typeof x === "string" ? x : JSON.stringify(x ?? "")).trim().toLowerCase();

export function consistencyScorer(spec: ConsistencySpec): Scorer {
  const mutations = spec.mutations ?? [...MUTATIONS];
  const n = spec.n ?? 2;
  const compare = spec.compare ?? "exact";
  const threshold = spec.jevThreshold ?? 0.7;
  let client = spec.client;
  return {
    name: String(spec.id ?? "consistency"),
    cacheKeyExtra: () => ({ mutations, n, compare }),
    async score(ctx) {
      if (!ctx.runTarget) return { scorer: "", value: 0, pass: null, reason: "consistency needs ctx.runTarget (provided by the executor)" };
      const evidence: Record<string, unknown>[] = [];
      let agreed = 0;
      let counted = 0;
      let costUsd = 0;
      for (let i = 0; i < n; i++) {
        const mutation = mutations[i % mutations.length]!;
        const input = mutate(mutation, ctx.case.input, Math.floor(i / mutations.length));
        if (input === undefined) {
          evidence.push({ mutation, skipped: true });
          continue;
        }
        counted++;
        const out = await ctx.runTarget(input);
        if (out.error) {
          evidence.push({ mutation, input, error: out.error, agree: false });
          continue;
        }
        let agree: boolean;
        let p: number | undefined;
        if (compare === "jev") {
          client ??= new JevClient();
          const res = await client.ask({ a: ctx.trace.output, b: out.output }, { same: noul("The two answers convey the same information", { true: "a and b state the same facts, wording aside", false: "a and b differ in facts, conclusions or scope" }) });
          costUsd += res.costUsd;
          p = res.answers.same?.type === "noul" ? res.answers.same.noul : 0;
          agree = p >= threshold;
        } else agree = norm(out.output) === norm(ctx.trace.output);
        if (agree) agreed++;
        evidence.push({ mutation, input, output: out.output, agree, ...(p !== undefined ? { p } : {}) });
      }
      if (counted === 0) return { scorer: "", value: 0, pass: null, reason: "no applicable mutations for this input", evidence };
      const value = agreed / counted;
      return { scorer: "", value, pass: value >= 0.5, reason: `${agreed}/${counted} perturbed inputs gave an equivalent answer`, evidence, costUsd };
    },
  };
}

registerScorerKind("consistency", (spec) => consistencyScorer(spec as ConsistencySpec));
