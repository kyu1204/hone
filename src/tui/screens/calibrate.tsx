import { useKeyboard } from "@opentui/react";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ReactNode } from "react";
import { useTui } from "../app";
import type { TuiStore } from "../state";
import { useTheme } from "../theme";
import { ListDetail } from "../widgets/listDetail";

/** Written by `hone calibrate` (T-604) to .hone/analysis/calibration-<judge>.json */
export interface CalibrationFile {
  schemaVersion: 1;
  judge: string;
  domain: string;
  faults: { type: string; injected: number; detected: number; rate: number; lo: number; hi: number }[];
  falseAlarms: { n: number; flagged: number; rate: number };
  kappa?: number;
}

export function readCalibrations(root: string): CalibrationFile[] {
  const dir = path.join(root, "analysis");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("calibration-") && f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as CalibrationFile];
      } catch {
        return [];
      }
    });
}

/** `[0.48, 0.86]` as a 20-cell bar with the point estimate marked. */
export function intervalBar(rate: number, lo: number, hi: number, width = 20): string {
  const cells = Array.from({ length: width }, (_, i) => {
    const x = i / (width - 1);
    if (Math.abs(x - rate) <= 0.5 / (width - 1)) return "█";
    return x >= lo && x <= hi ? "▒" : "·";
  });
  return cells.join("");
}

export function CalibrateScreen({ store }: { store: TuiStore }): ReactNode {
  const s = useTui(store);
  const theme = useTheme();
  const files = readCalibrations(s.root);
  useKeyboard((key) => {
    if (s.screen !== "calibrate" || s.inputActive) return;
    if (key.name === "j" || key.name === "down") store.moveEntry(1, files.length);
    else if (key.name === "k" || key.name === "up") store.moveEntry(-1, files.length);
  });
  const current = files[s.entryIdx];
  return (
    <ListDetail
      title="judges"
      empty="No calibration yet. Run `hone calibrate` to inject faults and measure what each judge catches."
      items={files.map((f) => ({ id: f.judge, label: f.judge, badge: f.domain }))}
      selected={s.entryIdx}
      detailTitle={current ? `${current.judge} on ${current.domain}` : undefined}
      detail={
        current ? (
          <box style={{ flexDirection: "column" }}>
            <text fg={theme.muted}>{"fault type".padEnd(26)}detected   rate   CI95            bar</text>
            {current.faults.map((f) => (
              <text key={f.type}>
                {f.type.padEnd(26)}
                {`${f.detected}/${f.injected}`.padEnd(11)}
                {f.rate.toFixed(2).padEnd(7)}
                {`[${f.lo.toFixed(2)}, ${f.hi.toFixed(2)}]`.padEnd(16)}
                <span fg={f.rate >= 0.7 ? theme.pass : f.rate >= 0.4 ? theme.flag : theme.fail}>{intervalBar(f.rate, f.lo, f.hi)}</span>
              </text>
            ))}
            <text> </text>
            <text>
              false alarms on clean runs: {current.falseAlarms.flagged}/{current.falseAlarms.n} = {current.falseAlarms.rate.toFixed(2)}
            </text>
            {current.kappa !== undefined ? <text>kappa vs human labels: {current.kappa.toFixed(2)}</text> : <text fg={theme.muted}>kappa: no human labels provided</text>}
          </box>
        ) : null
      }
    />
  );
}
