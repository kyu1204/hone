import type { ReactNode } from "react";
import type { ChatMessage, Span, Trial } from "../../core/types";
import { useTui } from "../app";
import type { TuiStore } from "../state";
import { useTheme } from "../theme";

export interface TraceEntry {
  kind: "score" | "message" | "span";
  summary: string;
  detail: string;
  context: string;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const text = (x: unknown): string => (typeof x === "string" ? x : JSON.stringify(x ?? "", null, 1));
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

function messageEntry(m: ChatMessage): TraceEntry {
  const body = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("\n");
  const calls = m.tool_calls ?? [];
  const head = m.role === "tool" ? `tool${m.name ? ` ${m.name}` : ""}` : m.role;
  const callText = calls.map((c) => `${c.function.name}(${clip(oneLine(c.function.arguments), 60)})`).join(", ");
  const summary = `${head.padEnd(9)} ${clip(oneLine(body), 70)}${callText ? `${body ? " " : ""}→ ${callText}` : ""}`;
  const detail = [body, ...calls.map((c) => `tool_call ${c.id} ${c.function.name}\n${c.function.arguments}`)].filter(Boolean).join("\n");
  const context = calls.length ? calls.map((c) => `${c.function.name}\n${text(safeJson(c.function.arguments))}`).join("\n\n") : body;
  return { kind: "message", summary, detail, context };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function spanEntries(spans: Span[]): TraceEntry[] {
  const children = new Map<string | undefined, Span[]>();
  for (const s of spans) (children.get(s.parentId) ?? children.set(s.parentId, []).get(s.parentId)!).push(s);
  const out: TraceEntry[] = [];
  const walk = (parent: string | undefined, depth: number): void => {
    for (const s of children.get(parent) ?? []) {
      const ms = s.endedAt ? `${Date.parse(s.endedAt) - Date.parse(s.startedAt)}ms` : "";
      const err = s.attrs?.error ? ` error=${clip(text(s.attrs.error), 40)}` : "";
      let context = text(s.output);
      if (s.kind === "retrieval" && Array.isArray(s.output)) {
        context = s.output
          .map((d, i) => {
            const o: Record<string, unknown> = typeof d === "object" && d !== null ? (d as Record<string, unknown>) : { text: d };
            return `${String(o.id ?? i)}${o.score !== undefined ? ` (${String(o.score)})` : ""}: ${clip(oneLine(String(o.text ?? o.content ?? "")), 200)}`;
          })
          .join("\n");
      }
      out.push({ kind: "span", summary: `${"  ".repeat(depth)}${s.kind} ${s.name} ${ms}${err}`, detail: `input: ${text(s.input)}\noutput: ${text(s.output)}`, context });
      walk(s.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

export function traceEntries(trial: Trial): TraceEntry[] {
  const scores = trial.scores.map<TraceEntry>((s) => ({
    kind: "score",
    summary: `${s.pass === true ? "✓" : s.pass === false ? "✗" : "?"} ${s.scorer.padEnd(18)} ${s.value.toFixed(2)}  ${s.reason ?? ""}`,
    detail: s.evidence?.length ? text(s.evidence) : "(no evidence)",
    context: s.evidence?.length ? text(s.evidence) : s.reason ?? "",
  }));
  return [...scores, ...trial.trace.messages.map(messageEntry), ...spanEntries(trial.trace.spans)];
}

export function TraceScreen({ store }: { store: TuiStore }): ReactNode {
  const s = useTui(store);
  const theme = useTheme();
  const cell = store.selectedCell();
  const trial = store.selectedTrial();
  if (!cell || !trial) {
    return (
      <box border style={{ flexGrow: 1 }}>
        <text fg={theme.muted}>Select a cell with trials in the matrix and press enter.</text>
      </box>
    );
  }
  const entries = traceEntries(trial);
  const q = s.search.trim().toLowerCase();
  const matches = q ? entries.map((e, i) => (`${e.summary}\n${e.detail}`.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0) : [];
  const verdict = trial.pass === true ? "PASS" : trial.pass === false ? "FAIL" : "UNDECIDED";
  const ms = Date.parse(trial.trace.endedAt) - Date.parse(trial.trace.startedAt);
  const current = entries[s.entryIdx];
  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <text>
        <span fg={theme.accent}>{cell.caseId}</span> · {cell.targetId} · #{s.trialIdx} of {cell.trials.length} ·{" "}
        <span fg={trial.pass === true ? theme.pass : trial.pass === false ? theme.fail : theme.undecided}>{verdict}</span>
        {trial.flags.length ? <span fg={theme.flag}> {trial.flags.join(" ")}</span> : null} · ${trial.costUsd.toFixed(4)} · {ms}ms{trial.trace.meta?.model ? ` · ${String(trial.trace.meta.model)}` : ""}
        {q ? <span fg={theme.muted}>{`  ·  "${s.search}" ${matches.length} match(es)`}</span> : null}
      </text>
      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        <box border title="trace" style={{ width: "60%", flexDirection: "column" }}>
          <scrollbox style={{ flexGrow: 1 }} focused={!s.inputActive}>
            {entries.map((e, i) => {
              const selected = i === s.entryIdx;
              const hit = matches.includes(i);
              const lines = [e.summary, ...(s.expanded.includes(i) ? e.detail.split("\n").map((l) => `    ${l}`) : [])];
              return (
                <text key={`${e.kind}-${i}`} fg={selected ? theme.accent : hit ? theme.flag : e.kind === "score" ? theme.fg : theme.muted}>
                  {lines.map((l, j) => (j === 0 ? `${selected ? "▶" : " "} ${l}` : l)).join("\n")}
                </text>
              );
            })}
          </scrollbox>
        </box>
        <box border title={current ? `${current.kind} context` : "context"} style={{ flexGrow: 1, flexDirection: "column" }}>
          <scrollbox style={{ flexGrow: 1 }}>
            <text>{current ? clip(current.context, 4000) : ""}</text>
          </scrollbox>
        </box>
      </box>
      {s.inputActive ? (
        <box style={{ height: 1, flexDirection: "row" }}>
          <text fg={theme.accent}>/ </text>
          <input focused value={s.search} placeholder="search (enter to apply, esc to cancel)" onInput={(v: string) => store.setSearch(v)} onSubmit={() => store.setInputActive(false)} />
        </box>
      ) : null}
    </box>
  );
}
