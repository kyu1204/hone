import type { ReactNode } from "react";
import { Store } from "../../core/store";
import type { Run } from "../../core/types";
import { wilsonCi } from "../../stats/interval";
import { useTui } from "../app";
import type { TuiStore } from "../state";
import { useTheme } from "../theme";
import { bar, braillePlot, sparkline } from "../widgets/chart";

export interface ChartData {
  history: { runId: string; passAt1: number }[];
  pareto: { id: string; passAt1: number; costPerSolve: number }[];
  intervals: { id: string; passAt1: number; lo: number; hi: number; n: number }[];
}

/** History of runs sharing the config hash, plus per-target cost/pass and intervals for `run`. */
export function chartData(root: string, run: Run, historyLimit = 20): ChartData {
  const store = new Store(root);
  try {
    const runs = store
      .listRuns(200)
      .filter((r) => r.configHash === run.configHash)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-historyLimit);
    const history = runs.map((r) => {
      const trials = store.queryTrials({ runId: r.id });
      return { runId: r.id, passAt1: trials.length ? trials.filter((t) => t.pass === true).length / trials.length : 0 };
    });
    const trials = store.queryTrials({ runId: run.id });
    const targets = [...new Set(trials.map((t) => t.trace.targetId))];
    const pareto = targets.map((id) => {
      const ts = trials.filter((t) => t.trace.targetId === id);
      const passed = ts.filter((t) => t.pass === true).length;
      const cost = ts.reduce((a, t) => a + t.costUsd, 0);
      return { id, passAt1: passed / ts.length, costPerSolve: passed ? cost / passed : Number.POSITIVE_INFINITY };
    });
    const intervals = targets.map((id) => {
      const ts = trials.filter((t) => t.trace.targetId === id);
      const passed = ts.filter((t) => t.pass === true).length;
      const ci = wilsonCi(passed, ts.length);
      return { id, passAt1: passed / ts.length, lo: ci.lo, hi: ci.hi, n: ts.length };
    });
    return { history, pareto, intervals };
  } finally {
    store.close();
  }
}

export function ChartsScreen({ store }: { store: TuiStore }): ReactNode {
  const s = useTui(store);
  const theme = useTheme();
  if (!s.run) {
    return (
      <box border style={{ flexGrow: 1 }}>
        <text fg={theme.muted}>No run to chart yet.</text>
      </box>
    );
  }
  const data = chartData(s.root, s.run);
  const finite = data.pareto.filter((p) => Number.isFinite(p.costPerSolve));
  const maxCost = Math.max(0.0001, ...finite.map((p) => p.costPerSolve));
  const plot = braillePlot(
    finite.map((p) => ({ x: p.costPerSolve / maxCost, y: p.passAt1 })),
    40,
    6,
  );
  const idWidth = Math.max(8, ...data.intervals.map((i) => i.id.length)) + 2;
  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <box border title="pass@1 over runs (same config)" style={{ flexDirection: "column" }}>
        <text>
          <span fg={theme.accent}>{sparkline(data.history.map((h) => h.passAt1), 40)}</span>  {data.history.length} run(s), latest {data.history.at(-1)?.passAt1.toFixed(2) ?? "n/a"}
        </text>
      </box>
      <box border title="cost vs pass@1 (x: $/solve, y: pass@1)" style={{ flexDirection: "row" }}>
        <box style={{ flexDirection: "column" }}>
          {plot.map((row, i) => (
            <text key={i} fg={theme.accent}>
              {row}
            </text>
          ))}
          <text fg={theme.muted}>{`0${" ".repeat(32)}$${maxCost.toFixed(3)}`}</text>
        </box>
        <box style={{ flexDirection: "column", paddingLeft: 2 }}>
          {data.pareto.map((p) => (
            <text key={p.id}>
              {p.id.padEnd(idWidth)} {p.passAt1.toFixed(2)}  {Number.isFinite(p.costPerSolve) ? `$${p.costPerSolve.toFixed(3)}/solve` : "no solves"}
            </text>
          ))}
        </box>
      </box>
      <box border title="pass@1 intervals (Wilson 95%)" style={{ flexDirection: "column", flexGrow: 1 }}>
        {data.intervals.map((i) => (
          <text key={i.id}>
            {i.id.padEnd(idWidth)} <span fg={i.passAt1 >= 0.8 ? theme.pass : i.passAt1 >= 0.5 ? theme.flag : theme.fail}>{bar(i.passAt1, i.lo, i.hi, 30)}</span> {i.passAt1.toFixed(2)} [{i.lo.toFixed(2)}, {i.hi.toFixed(2)}] n={i.n}
          </text>
        ))}
      </box>
    </box>
  );
}
