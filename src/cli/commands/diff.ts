import { divergenceReport } from "../../analysis/diffTrace";
import { Store } from "../../core/store";
import type { ChatMessage } from "../../core/types";
import { ArgError, parseArgs } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const DIFF_SPEC = { flags: ["json"], strings: [], numbers: ["width"], repeatable: [] } as const;

export function diffUsage(): string {
  return "usage: hone diff <trialA> <trialB> [--json] [--width n]\n\nAlign two trajectories step by step and report where they diverge.\n";
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function cell(m: ChatMessage | undefined, width: number): string {
  if (!m) return "·".padEnd(width);
  const body = (typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ")).replace(/\s+/g, " ").trim();
  const calls = m.tool_calls?.map((c) => `${c.function.name}(${c.function.arguments})`).join(", ");
  const head = m.role === "tool" ? `tool ${m.name ?? ""}`.trim() : m.role;
  return clip(`${head}${calls ? ` → ${calls}` : ""}${body ? ` ${body}` : ""}`, width).padEnd(width);
}

export async function diffCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, DIFF_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${diffUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(diffUsage());
    return 0;
  }
  const [idA, idB] = args.positionals;
  if (!idA || !idB) {
    io.stderr(diffUsage());
    return 2;
  }
  const store = new Store(await storeRoot(io));
  try {
    const a = store.getTrial(idA);
    const b = store.getTrial(idB);
    if (!a || !b) {
      io.stderr(`trial ${!a ? idA : idB} not found\n`);
      return 2;
    }
    const rows = divergenceReport(a.trace.messages, b.trace.messages);
    const divergence = rows.findIndex((r) => r.kind !== "identical");
    if (args.flags.json) {
      io.stdout(`${JSON.stringify({ a: a.id, b: b.id, divergence: divergence === -1 ? null : divergence, rows }, null, 2)}\n`);
      return 0;
    }
    const width = Math.max(20, Math.floor(((args.numbers.width ?? 120) - 24) / 2));
    const lines = [`A ${a.id} ${a.pass === true ? "PASS" : a.pass === false ? "FAIL" : "?"}   B ${b.id} ${b.pass === true ? "PASS" : b.pass === false ? "FAIL" : "?"}`, divergence === -1 ? "identical sequence" : `diverges at step ${divergence}`, ""];
    for (const r of rows) lines.push(`${String(r.step).padStart(3)} ${cell(r.aMessage, width)} │ ${cell(r.bMessage, width)}  ${r.kind === "identical" ? "" : r.kind}`.trimEnd());
    io.stdout(`${lines.join("\n")}\n`);
    return 0;
  } finally {
    store.close();
  }
}
