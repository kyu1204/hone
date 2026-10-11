import { useKeyboard } from "@opentui/react";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ReactNode } from "react";
import { useTui } from "../app";
import type { TuiStore } from "../state";
import { useTheme } from "../theme";
import { ListDetail } from "../widgets/listDetail";

export interface Candidate {
  id: string;
  text: string;
  passAt1: number;
  lo: number;
  hi: number;
  costUsd: number;
  pareto: boolean;
  parent?: string;
}

/** Written by `hone evolve` (T-702) to .hone/evolve/<id>.json and `hone optimize` (T-703) to .hone/optimize/<id>.json */
export interface CandidatesFile {
  schemaVersion: 1;
  kind: "evolve" | "optimize";
  baseline: Candidate;
  candidates: Candidate[];
}

/** The most recently written candidates file across evolve/ and optimize/. */
export function readCandidates(root: string): CandidatesFile | undefined {
  const files: { file: string; mtime: number }[] = [];
  for (const dir of ["evolve", "optimize"]) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith(".json")) files.push({ file: path.join(d, f), mtime: fs.statSync(path.join(d, f)).mtimeMs });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const { file } of files) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as CandidatesFile;
    } catch {
      // try the next one
    }
  }
  return undefined;
}

/** Line diff (LCS) rendered as `  `, `- `, `+ ` prefixed lines. */
export function textDiff(a: string, b: string): string[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => Array.from({ length: y.length + 1 }, () => 0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      out.push(`  ${x[i]}`);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push(`- ${x[i++]}`);
    else out.push(`+ ${y[j++]}`);
  }
  while (i < x.length) out.push(`- ${x[i++]}`);
  while (j < y.length) out.push(`+ ${y[j++]}`);
  return out;
}

export function CandidatesScreen({ store }: { store: TuiStore }): ReactNode {
  const s = useTui(store);
  const theme = useTheme();
  const file = readCandidates(s.root);
  const candidates = [...(file?.candidates ?? [])].sort((a, b) => b.passAt1 - a.passAt1);
  useKeyboard((key) => {
    if (s.screen !== "candidates" || s.inputActive) return;
    if (key.name === "j" || key.name === "down") store.moveEntry(1, candidates.length);
    else if (key.name === "k" || key.name === "up") store.moveEntry(-1, candidates.length);
    else if (key.name === "return") store.toggleExpanded();
  });
  const current = candidates[s.entryIdx];
  const showDiff = s.expanded.includes(s.entryIdx);
  return (
    <ListDetail
      title={file ? `${file.kind} candidates` : "candidates"}
      empty="No candidates yet. Run `hone evolve` or `hone optimize` to generate and score variants."
      items={candidates.map((c) => ({ id: c.id, label: `${c.pareto ? "★ " : "  "}${c.id}`, badge: `${c.passAt1.toFixed(2)} [${c.lo.toFixed(2)}, ${c.hi.toFixed(2)}] $${c.costUsd.toFixed(2)}` }))}
      selected={s.entryIdx}
      detailTitle={current ? `${current.id}${showDiff ? " vs baseline (enter: text)" : " text (enter: diff vs baseline)"}` : undefined}
      detail={
        current && file ? (
          <box style={{ flexDirection: "column" }}>
            <text fg={theme.muted}>
              baseline {file.baseline.passAt1.toFixed(2)} [{file.baseline.lo.toFixed(2)}, {file.baseline.hi.toFixed(2)}] ${file.baseline.costUsd.toFixed(2)} · ★ = on the Pareto frontier
            </text>
            {(showDiff ? textDiff(file.baseline.text, current.text) : current.text.split("\n")).map((line, i) => (
              <text key={i} fg={line.startsWith("+ ") ? theme.pass : line.startsWith("- ") ? theme.fail : theme.fg}>
                {line}
              </text>
            ))}
          </box>
        ) : null
      }
    />
  );
}
