// Align two message lists by role and tool-call signature (LCS) and classify where they part.
import type { ChatMessage } from "../core/types";

export function signature(m: ChatMessage): string {
  if (m.role === "tool") return `tool:${m.name ?? ""}`;
  const tools = m.tool_calls?.map((c) => c.function.name) ?? [];
  return tools.length ? `${m.role}:${tools.join(",")}` : m.role;
}

export interface Alignment {
  /** [indexInA | null, indexInB | null] rows in display order. */
  pairs: [number | null, number | null][];
  /** Row index of the first unmatched pair, or null when both sequences match throughout. */
  divergence: number | null;
}

export function alignTraces(a: ChatMessage[], b: ChatMessage[]): Alignment {
  const sa = a.map(signature);
  const sb = b.map(signature);
  const n = sa.length;
  const m = sb.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = sa[i] === sb[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const pairs: [number | null, number | null][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sa[i] === sb[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) pairs.push([i++, null]);
    else pairs.push([null, j++]);
  }
  while (i < n) pairs.push([i++, null]);
  while (j < m) pairs.push([null, j++]);
  const divergence = pairs.findIndex(([x, y]) => x === null || y === null);
  return { pairs, divergence: divergence === -1 ? null : divergence };
}

export type DivergenceKind = "identical" | "different-content" | "different-tool-args" | "missing-in-a" | "missing-in-b";

export interface DivergenceRow {
  /** Row index in the alignment (display order). */
  step: number;
  aMessage?: ChatMessage;
  bMessage?: ChatMessage;
  kind: DivergenceKind;
}

const argsOf = (m: ChatMessage): string => JSON.stringify(m.tool_calls?.map((c) => c.function.arguments) ?? []);
const contentOf = (m: ChatMessage): string => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));

/** Alignment rows classified: gaps, same tool with other arguments, same shape with other content, identical. */
export function divergenceReport(a: ChatMessage[], b: ChatMessage[]): DivergenceRow[] {
  return alignTraces(a, b).pairs.map(([i, j], step) => {
    const aMessage = i === null ? undefined : a[i];
    const bMessage = j === null ? undefined : b[j];
    let kind: DivergenceKind = "identical";
    if (!aMessage) kind = "missing-in-a";
    else if (!bMessage) kind = "missing-in-b";
    else if (aMessage.tool_calls?.length && argsOf(aMessage) !== argsOf(bMessage)) kind = "different-tool-args";
    else if (contentOf(aMessage) !== contentOf(bMessage)) kind = "different-content";
    return { step, aMessage, bMessage, kind };
  });
}
