/**
 * USD per million tokens. Edit this table when prices change; unknown models cost 0
 * and callers surface `unknownPricing` so a zero is never mistaken for free.
 * Verify against the vendor price pages before a release.
 */
export interface Price {
  inputPerM: number;
  outputPerM: number;
}

export const PRICING: Record<string, Price> = {
  "claude-sonnet-5-5": { inputPerM: 3, outputPerM: 15 },
  "claude-opus-5-5": { inputPerM: 15, outputPerM: 75 },
  "claude-haiku-5-5": { inputPerM: 1, outputPerM: 5 },
  "gpt-5": { inputPerM: 1.25, outputPerM: 10 },
  "gpt-5-mini": { inputPerM: 0.25, outputPerM: 2 },
};

export function priceOf(model: string): Price | undefined {
  return PRICING[model] ?? PRICING[model.replace(/-\d{8}$/, "")];
}

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  if (!p) return 0;
  return (inputTokens * p.inputPerM + outputTokens * p.outputPerM) / 1_000_000;
}
