import type { ReactNode } from "react";
import type { Trial } from "../../core/types";
import { verdictFor } from "../../stats/passk";
import { useTui } from "../app";
import type { TuiCell, TuiStore } from "../state";
import { useTheme } from "../theme";

/** `●○● 0.67`, `+` after five dots, `⚑` for reward hacks, `⏱` for timeouts, `·` when empty. */
export function cellLabel(trials: Trial[]): string {
  if (trials.length === 0) return "·";
  const dots = trials.slice(0, 5).map((t) => (t.pass === true ? "●" : "○")).join("") + (trials.length > 5 ? "+" : "");
  const rate = trials.filter((t) => t.pass === true).length / trials.length;
  const marks = [trials.some((t) => t.flags.includes("reward-hack")) ? " ⚑" : "", trials.some((t) => t.flags.includes("timeout")) ? " ⏱" : ""].join("");
  return `${dots} ${rate.toFixed(2)}${marks}`;
}

function summaryFor(cells: TuiCell[], targetId: string): string {
  const mine = cells.filter((c) => c.targetId === targetId && c.trials.length);
  const trials = mine.flatMap((c) => c.trials);
  if (trials.length === 0) return "·";
  const passed = trials.filter((t) => t.pass === true).length;
  const k3 = mine.map((c) => verdictFor(c.caseId, targetId, c.trials.map((t) => t.pass === true)).passHatK[3]).filter((v): v is number => v !== undefined);
  const cost = trials.reduce((a, t) => a + t.costUsd, 0);
  return `pass@1 ${(passed / trials.length).toFixed(2)} ^3 ${k3.length ? (k3.reduce((a, b) => a + b, 0) / k3.length).toFixed(2) : "n/a"} $/solve ${passed ? (cost / passed).toFixed(3) : "n/a"}`;
}

export function MatrixScreen({ store }: { store: TuiStore }): ReactNode {
  const s = useTui(store);
  const theme = useTheme();
  if (!s.runId) {
    return (
      <box border style={{ flexGrow: 1 }}>
        <text fg={theme.muted}>No runs yet. Run `hone run` in this project, then come back.</text>
      </box>
    );
  }
  const cases = store.visibleCases();
  const caseWidth = Math.min(28, Math.max(10, ...cases.map((c) => c.length)) + 2);
  const colWidth = 16;
  const header = `${"case \\ target".padEnd(caseWidth)}${s.targets.map((t) => t.slice(0, colWidth - 2).padEnd(colWidth)).join("")}`;
  return (
    <box border title={`matrix  sort:${s.sort}${s.filter ? `  filter:${s.filter}` : ""}`} style={{ flexGrow: 1, flexDirection: "column" }}>
      <text fg={theme.muted}>{header}</text>
      <scrollbox style={{ flexGrow: 1 }} focused={!s.inputActive}>
        {cases.map((caseId, ci) => (
          <text key={caseId}>
            <span fg={ci === s.selected.caseIdx ? theme.accent : theme.fg}>{(ci === s.selected.caseIdx ? "▶" : " ") + caseId.slice(0, caseWidth - 2).padEnd(caseWidth - 1)}</span>
            {s.targets.map((targetId, ti) => {
              const cell = s.cells.find((c) => c.caseId === caseId && c.targetId === targetId);
              const selected = ci === s.selected.caseIdx && ti === s.selected.targetIdx;
              const rate = cell?.verdict.passAt1 ?? -1;
              const color = selected ? theme.accent : !cell?.trials.length ? theme.muted : rate === 1 ? theme.pass : rate === 0 ? theme.fail : theme.undecided;
              return (
                <span key={targetId} fg={color}>
                  {(selected ? "[" : " ") + cellLabel(cell?.trials ?? []).padEnd(colWidth - 2) + (selected ? "]" : " ")}
                </span>
              );
            })}
          </text>
        ))}
      </scrollbox>
      {s.summary ? (
        <text fg={theme.muted}>{`${"summary".padEnd(caseWidth)}${s.targets.map((t) => summaryFor(s.cells, t).slice(0, colWidth * 2)).join("  ")}`}</text>
      ) : null}
      {s.inputActive ? (
        <box style={{ height: 1, flexDirection: "row" }}>
          <text fg={theme.accent}>/ </text>
          <input focused value={s.filter} placeholder="filter cases (enter to apply, esc to cancel)" onInput={(v: string) => store.setFilter(v)} onSubmit={() => store.setInputActive(false)} />
        </box>
      ) : null}
    </box>
  );
}
