import { useKeyboard } from "@opentui/react";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ReactNode } from "react";
import type { FailureCode } from "../../core/types";
import { useTui } from "../app";
import type { TuiStore } from "../state";
import { useTheme } from "../theme";
import { ListDetail } from "../widgets/listDetail";

export interface ClusterCode extends FailureCode {
  count: number;
  trialIds: string[];
}

/** Written by `hone cluster` (T-601/T-602) to .hone/analysis/clusters-<runId>.json */
export interface ClustersFile {
  schemaVersion: 1;
  runId: string;
  codes: ClusterCode[];
}

export function readClusters(root: string, runId: string): ClustersFile | undefined {
  const file = path.join(root, "analysis", `clusters-${runId}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ClustersFile;
  } catch {
    return undefined;
  }
}

export function ClustersScreen({ store }: { store: TuiStore }): ReactNode {
  const s = useTui(store);
  const theme = useTheme();
  const file = s.runId ? readClusters(s.root, s.runId) : undefined;
  const codes = [...(file?.codes ?? [])].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...codes.map((c) => c.count));
  useKeyboard((key) => {
    if (s.screen !== "clusters" || s.inputActive) return;
    if (key.name === "j" || key.name === "down") store.moveEntry(1, codes.length);
    else if (key.name === "k" || key.name === "up") store.moveEntry(-1, codes.length);
    else if (key.name === "return") {
      const id = codes[s.entryIdx]?.trialIds[0];
      if (id) store.openTrialById(id);
    }
  });
  const current = codes[s.entryIdx];
  return (
    <ListDetail
      title="failure codes"
      empty="No clusters for this run yet. Run `hone cluster` to group failures and induce a taxonomy."
      items={codes.map((c) => ({ id: c.code, label: c.code, badge: `${"█".repeat(Math.round((c.count / max) * 8))} ${c.count}` }))}
      selected={s.entryIdx}
      detail={
        current ? (
          <box style={{ flexDirection: "column" }}>
            <text>
              <span fg={theme.muted}>axis </span>
              {current.axis}
            </text>
            <text>{current.definition}</text>
            <text fg={theme.muted}>evidence: {current.evidencePatterns.join(" · ")}</text>
            <text> </text>
            <text fg={theme.muted}>trials ({current.trialIds.length}), enter opens the first:</text>
            {current.trialIds.slice(0, 30).map((id) => (
              <text key={id}>  {id}</text>
            ))}
          </box>
        ) : null
      }
    />
  );
}
