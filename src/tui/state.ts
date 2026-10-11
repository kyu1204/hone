// External store for the TUI: a snapshot of one run (cells, trials, selection, screen) that React
// reads through useSyncExternalStore and that the matrix, trace and other screens mutate via actions.
import { Store } from "../core/store";
import type { Run, Trial, Verdict } from "../core/types";
import { verdictFor } from "../stats/passk";

export type Screen = "matrix" | "trace" | "diff" | "clusters" | "calibrate" | "candidates" | "fork" | "charts";
export const SCREENS: Screen[] = ["matrix", "trace", "diff", "clusters", "calibrate", "candidates", "fork", "charts"];

export interface TuiCell {
  caseId: string;
  targetId: string;
  verdict: Verdict;
  trials: Trial[];
}

export interface TuiSnapshot {
  runId: string | undefined;
  run: Run | undefined;
  cases: string[];
  targets: string[];
  cells: TuiCell[];
  trials: Trial[];
  passAt1: number;
  costUsd: number;
  selected: { caseIdx: number; targetIdx: number };
  screen: Screen;
  trialIdx: number;
  help: boolean;
  readOnly: boolean;
  loadedAt: number;
  /** Second cell chosen for the diff screen. */
  diffWith?: { caseId: string; targetId: string; trialIdx: number };
  filter: string;
  sort: SortMode;
  summary: boolean;
  /** A text input owns the keyboard; global keys are suspended. */
  inputActive: boolean;
  /** Diff screen: show the selected trial as A and diffWith as B. */
  diffSwap: boolean;
  /** Trace and diff screens: selected entry, expanded entries, search text. */
  entryIdx: number;
  expanded: number[];
  search: string;
}

export type SortMode = "case" | "passAsc" | "passDesc" | "cost";
export const SORT_MODES: SortMode[] = ["case", "passAsc", "passDesc", "cost"];

export interface TuiStoreOptions {
  root: string;
  runId?: string;
  watch?: boolean;
  pollMs?: number;
  readOnly?: boolean;
}

export interface TuiStore {
  subscribe(fn: () => void): () => void;
  getSnapshot(): TuiSnapshot;
  reload(): void;
  move(dCase: number, dTarget: number): void;
  enter(): void;
  back(): void;
  setScreen(s: Screen): void;
  toggleHelp(): void;
  nextTrial(d: number): void;
  selectedCell(): TuiCell | undefined;
  selectedTrial(): Trial | undefined;
  setDiffWith(cell: { caseId: string; targetId: string; trialIdx: number } | undefined): void;
  setFilter(text: string): void;
  cycleSort(): void;
  toggleSummary(): void;
  setInputActive(active: boolean): void;
  /** Cases in display order after filter and sort. */
  visibleCases(): string[];
  moveEntry(d: number, total: number): void;
  setEntryIdx(i: number): void;
  toggleExpanded(): void;
  setSearch(text: string): void;
  toggleDiffSwap(): void;
  dispose(): void;
}

function load(root: string, runId: string | undefined): Pick<TuiSnapshot, "runId" | "run" | "cases" | "targets" | "cells" | "trials" | "passAt1" | "costUsd"> {
  const store = new Store(root);
  try {
    const run = runId ? store.getRun(runId) : store.listRuns(1)[0];
    if (!run) return { runId: undefined, run: undefined, cases: [], targets: [], cells: [], trials: [], passAt1: 0, costUsd: 0 };
    const trials = store.queryTrials({ runId: run.id });
    const caseOrder = run.caseIds.length ? run.caseIds : [...new Set(trials.map((t) => t.trace.caseId))];
    const cases = caseOrder.filter((c) => trials.some((t) => t.trace.caseId === c));
    for (const t of trials) if (!cases.includes(t.trace.caseId)) cases.push(t.trace.caseId);
    const targets = run.targets.length ? [...run.targets] : [];
    for (const t of trials) if (!targets.includes(t.trace.targetId)) targets.push(t.trace.targetId);
    const cells: TuiCell[] = [];
    for (const caseId of cases)
      for (const targetId of targets) {
        const ts = trials.filter((t) => t.trace.caseId === caseId && t.trace.targetId === targetId).sort((a, b) => a.trace.trial - b.trace.trial);
        cells.push({ caseId, targetId, verdict: verdictFor(caseId, targetId, ts.map((t) => t.pass === true)), trials: ts });
      }
    const passed = trials.filter((t) => t.pass === true).length;
    return { runId: run.id, run, cases, targets, cells, trials, passAt1: trials.length ? passed / trials.length : 0, costUsd: trials.reduce((a, t) => a + t.costUsd, 0) };
  } finally {
    store.close();
  }
}

export function createTuiStore(opts: TuiStoreOptions): TuiStore {
  const listeners = new Set<() => void>();
  let snap: TuiSnapshot = { ...load(opts.root, opts.runId), selected: { caseIdx: 0, targetIdx: 0 }, screen: "matrix", trialIdx: 0, help: false, readOnly: opts.readOnly ?? false, loadedAt: Date.now(), filter: "", sort: "case", summary: false, inputActive: false, entryIdx: 0, expanded: [], search: "", diffSwap: false };
  const emit = (): void => {
    for (const fn of listeners) fn();
  };
  const set = (patch: Partial<TuiSnapshot>): void => {
    snap = { ...snap, ...patch };
    emit();
  };
  const clamp = (n: number, max: number): number => Math.max(0, Math.min(Math.max(0, max - 1), n));
  const visibleCases = (s: TuiSnapshot): string[] => {
    const f = s.filter.trim().toLowerCase();
    const cases = s.cases.filter((c) => !f || c.toLowerCase().includes(f) || s.cells.some((cell) => cell.caseId === c && cell.trials.some((t) => (t.trace.meta?.tags as string[] | undefined)?.some((tag) => tag.toLowerCase().includes(f)))));
    const meanPass = (c: string): number => {
      const cells = s.cells.filter((cell) => cell.caseId === c && cell.trials.length);
      return cells.length ? cells.reduce((a, cell) => a + cell.verdict.passAt1, 0) / cells.length : -1;
    };
    const cost = (c: string): number => s.cells.filter((cell) => cell.caseId === c).reduce((a, cell) => a + cell.trials.reduce((x, t) => x + t.costUsd, 0), 0);
    if (s.sort === "passAsc") return [...cases].sort((a, b) => meanPass(a) - meanPass(b));
    if (s.sort === "passDesc") return [...cases].sort((a, b) => meanPass(b) - meanPass(a));
    if (s.sort === "cost") return [...cases].sort((a, b) => cost(b) - cost(a));
    return cases;
  };
  const cellAt = (s: TuiSnapshot): TuiCell | undefined => {
    const caseId = visibleCases(s)[s.selected.caseIdx];
    return s.cells.find((c) => c.caseId === caseId && c.targetId === s.targets[s.selected.targetIdx]);
  };

  const timer = opts.watch ? setInterval(() => reload(), opts.pollMs ?? 1000) : undefined;
  function reload(): void {
    const fresh = load(opts.root, opts.runId ?? snap.runId);
    set({ ...fresh, selected: { caseIdx: clamp(snap.selected.caseIdx, fresh.cases.length), targetIdx: clamp(snap.selected.targetIdx, fresh.targets.length) }, loadedAt: Date.now() });
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snap,
    reload,
    move(dCase, dTarget) {
      set({ selected: { caseIdx: clamp(snap.selected.caseIdx + dCase, visibleCases(snap).length), targetIdx: clamp(snap.selected.targetIdx + dTarget, snap.targets.length) } });
    },
    enter() {
      const cell = cellAt(snap);
      if (!cell || cell.trials.length === 0) return;
      set({ screen: "trace", trialIdx: 0, entryIdx: 0, expanded: [], search: "" });
    },
    back() {
      if (snap.help) set({ help: false });
      else if (snap.screen !== "matrix") set({ screen: "matrix" });
    },
    setScreen(screen) {
      set({ screen, help: false, entryIdx: 0, expanded: [] });
    },
    toggleHelp() {
      set({ help: !snap.help });
    },
    nextTrial(d) {
      const cell = cellAt(snap);
      if (!cell) return;
      set({ trialIdx: clamp(snap.trialIdx + d, cell.trials.length), entryIdx: 0, expanded: [] });
    },
    selectedCell: () => cellAt(snap),
    selectedTrial: () => cellAt(snap)?.trials[snap.trialIdx],
    setDiffWith(cell) {
      set({ diffWith: cell });
    },
    setFilter(text) {
      set({ filter: text, selected: { caseIdx: 0, targetIdx: snap.selected.targetIdx } });
    },
    cycleSort() {
      set({ sort: SORT_MODES[(SORT_MODES.indexOf(snap.sort) + 1) % SORT_MODES.length]!, selected: { ...snap.selected, caseIdx: 0 } });
    },
    toggleSummary() {
      set({ summary: !snap.summary });
    },
    setInputActive(active) {
      set({ inputActive: active });
    },
    visibleCases: () => visibleCases(snap),
    moveEntry(d, total) {
      set({ entryIdx: clamp(snap.entryIdx + d, total) });
    },
    setEntryIdx(i) {
      set({ entryIdx: Math.max(0, i) });
    },
    toggleExpanded() {
      set({ expanded: snap.expanded.includes(snap.entryIdx) ? snap.expanded.filter((i) => i !== snap.entryIdx) : [...snap.expanded, snap.entryIdx] });
    },
    setSearch(text) {
      set({ search: text });
    },
    toggleDiffSwap() {
      set({ diffSwap: !snap.diffSwap });
    },
    dispose() {
      if (timer) clearInterval(timer);
      listeners.clear();
    },
  };
}
