import type { ReactNode } from "react";
import type { ChatMessage, Trial } from "../../core/types";
import { alignTraces } from "../../analysis/diffTrace";
import { useTui } from "../app";
import type { TuiStore } from "../state";
import { useTheme } from "../theme";

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export function messageLine(m: ChatMessage | undefined, width: number): string {
  if (!m) return "".padEnd(width);
  const body = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ");
  const calls = m.tool_calls?.map((c) => `${c.function.name}()`).join(",");
  const head = m.role === "tool" ? `tool:${m.name ?? ""}` : m.role;
  return clip(`${head} ${calls ? `→ ${calls} ` : ""}${body.replace(/\s+/g, " ")}`, width).padEnd(width);
}

export function diffSides(store: TuiStore): { a: Trial; b: Trial } | undefined {
  const s = store.getSnapshot();
  const b = store.selectedTrial();
  if (!s.diffWith || !b) return undefined;
  const cellA = s.cells.find((c) => c.caseId === s.diffWith!.caseId && c.targetId === s.diffWith!.targetId);
  const a = cellA?.trials[s.diffWith.trialIdx];
  if (!a) return undefined;
  return s.diffSwap ? { a: b, b: a } : { a, b };
}

export function DiffScreen({ store }: { store: TuiStore }): ReactNode {
  const s = useTui(store);
  const theme = useTheme();
  const sides = diffSides(store);
  if (!sides) {
    return (
      <box border style={{ flexGrow: 1 }}>
        <text fg={theme.muted}>Press d on two cells in the matrix (or D in a trace) to compare two trajectories.</text>
      </box>
    );
  }
  const { a, b } = sides;
  const { pairs, divergence } = alignTraces(a.trace.messages, b.trace.messages);
  const verdict = (t: Trial): string => (t.pass === true ? "PASS" : t.pass === false ? "FAIL" : "UNDECIDED");
  const colWidth = 54;
  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <text>
        <span fg={theme.accent}>A</span> {a.id} {verdict(a)} ${a.costUsd.toFixed(3)}   <span fg={theme.accent}>B</span> {b.id} {verdict(b)} ${b.costUsd.toFixed(3)}   {divergence === null ? "identical sequence" : `diverges at step ${divergence}`}
      </text>
      <box border title="A | B" style={{ flexGrow: 1, flexDirection: "column" }}>
        <scrollbox style={{ flexGrow: 1 }} focused>
          {pairs.map(([ia, ib], row) => {
            const selected = row === s.entryIdx;
            const before = divergence !== null && row < divergence;
            const isDivergence = row === divergence;
            const color = selected ? theme.accent : isDivergence ? theme.flag : before ? theme.muted : theme.fg;
            const left = messageLine(ia === null ? undefined : a.trace.messages[ia], colWidth);
            const right = messageLine(ib === null ? undefined : b.trace.messages[ib], colWidth);
            const gap = ia === null ? "+B " : ib === null ? "+A " : "   ";
            const expanded = s.expanded.includes(row);
            const lines = [`${selected ? "▶" : " "}${gap}${left} │ ${right}`];
            if (expanded) {
              const full = (m: ChatMessage | undefined): string => (!m ? "(none)" : typeof m.content === "string" ? m.content : JSON.stringify(m.content));
              lines.push(`    A: ${clip(full(ia === null ? undefined : a.trace.messages[ia]), 400)}`, `    B: ${clip(full(ib === null ? undefined : b.trace.messages[ib]), 400)}`);
            }
            return (
              <text key={row} fg={color}>
                {lines.join("\n")}
              </text>
            );
          })}
        </scrollbox>
      </box>
    </box>
  );
}
