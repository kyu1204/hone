import type { ReactNode } from "react";
import { pickSibling, rankBranchPoints, topSteps } from "../../analysis/branchpoints";
import type { ChatMessage } from "../../core/types";
import { useTui } from "../app";
import type { TuiStore } from "../state";
import { useTheme } from "../theme";

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const body = (m: ChatMessage): string => (typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" "));

export function ForkScreen({ store }: { store: TuiStore }): ReactNode {
  const s = useTui(store);
  const theme = useTheme();
  const trial = store.selectedTrial();
  if (!trial) {
    return (
      <box border style={{ flexGrow: 1 }}>
        <text fg={theme.muted}>Open a trial first (enter on a matrix cell), then press f to fork it.</text>
      </box>
    );
  }
  const messages = trial.trace.messages;
  const stars = new Set(trial.pass === false ? topSteps(rankBranchPoints(trial, pickSibling(trial, s.trials)), 3) : []);
  const current = s.forkEdit && s.forkStep < messages.length ? s.forkEdit : messages[s.forkStep];
  const result = s.forkResult;
  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <text>
        <span fg={theme.accent}>fork</span> {trial.id} at step {s.forkStep}
        {s.readOnly ? <span fg={theme.flag}>  read-only: forks are disabled</span> : null}
        {s.forkRunning ? <span fg={theme.flag}>  running…</span> : null}
        {s.forkError ? <span fg={theme.fail}>  {s.forkError}</span> : null}
      </text>
      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        <box border title="steps" style={{ width: "45%", flexDirection: "column" }}>
          <scrollbox style={{ flexGrow: 1 }} focused={!s.inputActive}>
            {messages.map((m, i) => (
              <text key={i} fg={i === s.forkStep ? theme.accent : i < s.forkStep ? theme.muted : theme.fg}>
                {(i === s.forkStep ? "▶" : stars.has(i) ? "★" : " ") + " " + String(i).padStart(2)} {m.role.padEnd(9)} {clip(body(m).replace(/\s+/g, " "), 40)}
                {m.tool_calls?.length ? ` → ${m.tool_calls.map((c) => c.function.name).join(",")}` : ""}
              </text>
            ))}
          </scrollbox>
        </box>
        <box border title={result ? "result" : "step content (enter to edit, r to run)"} style={{ flexGrow: 1, flexDirection: "column" }}>
          {result ? (
            <box style={{ flexDirection: "column" }}>
              <text>
                forked trial {result.id}:{" "}
                <span fg={result.pass === true ? theme.pass : result.pass === false ? theme.fail : theme.undecided}>{result.pass === true ? "PASS" : result.pass === false ? "FAIL" : "UNDECIDED"}</span>
                {"  "}(original {trial.pass === true ? "PASS" : trial.pass === false ? "FAIL" : "UNDECIDED"})
              </text>
              {result.scores.map((sc) => (
                <text key={sc.scorer} fg={sc.pass === true ? theme.pass : sc.pass === false ? theme.fail : theme.muted}>
                  {sc.pass === true ? "✓" : sc.pass === false ? "✗" : "?"} {sc.scorer} {sc.value.toFixed(2)} {sc.reason ?? ""}
                </text>
              ))}
              <text fg={theme.muted}>output: {clip(typeof result.trace.output === "string" ? result.trace.output : JSON.stringify(result.trace.output), 600)}</text>
              <text fg={theme.muted}>d opens the diff against the original, enter edits again.</text>
            </box>
          ) : current ? (
            <scrollbox style={{ flexGrow: 1 }}>
              <text>{body(current)}</text>
            </scrollbox>
          ) : null}
        </box>
      </box>
      {s.inputActive && s.forkEdit ? (
        <box style={{ height: 1, flexDirection: "row" }}>
          <text fg={theme.accent}>edit </text>
          <input focused value={body(s.forkEdit)} placeholder="new content (enter to keep, esc to cancel)" onInput={(v: string) => store.setForkEditContent(v)} onSubmit={() => store.commitForkEdit()} />
        </box>
      ) : null}
    </box>
  );
}
