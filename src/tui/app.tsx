import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { type ReactNode, useSyncExternalStore } from "react";
import { SCREENS, type Screen, type TuiStore } from "./state";
import { MatrixScreen } from "./screens/matrix";
import { useTheme } from "./theme";

export interface AppProps {
  store: TuiStore;
  onQuit: () => void;
}

const SCREEN_KEYS: Record<string, Screen> = { "1": "matrix", "2": "trace", "3": "diff", "4": "clusters", "5": "calibrate", "6": "candidates", "7": "fork", "8": "charts" };

export const KEYMAP: Record<Screen | "global", string> = {
  global: "q quit  ? help  esc back  1-8 screens  r reload",
  matrix: "h/j/k/l move  enter open trial  d diff  s sort  / filter",
  trace: "j/k move  enter expand  e evidence  [ ] trials  / search  f fork  D diff prev",
  diff: "j/k move  n divergence  enter expand  tab swap",
  clusters: "j/k move  enter open trial",
  calibrate: "j/k move",
  candidates: "j/k move  enter diff vs baseline",
  fork: "j/k step  enter edit  r run  d diff",
  charts: "no keys",
};

export function useTui(store: TuiStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function Header({ store }: { store: TuiStore }): ReactNode {
  const s = useTui(store);
  const theme = useTheme();
  const runLabel = s.runId ? s.runId.slice(0, 19) : "no run";
  return (
    <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between" }}>
      <text>
        <span fg={theme.accent}>hone</span> {runLabel}  pass@1 {s.passAt1.toFixed(2)}  ${s.costUsd.toFixed(2)}  {s.trials.length} trials{s.readOnly ? "  read-only" : ""}
      </text>
      <text fg={theme.muted}>[{s.screen}]</text>
    </box>
  );
}

function Footer({ store }: { store: TuiStore }): ReactNode {
  const s = useTui(store);
  const theme = useTheme();
  return (
    <box style={{ height: 1 }}>
      <text fg={theme.muted}>{KEYMAP[s.screen]}  ·  {KEYMAP.global}</text>
    </box>
  );
}

function HelpOverlay(): ReactNode {
  const theme = useTheme();
  return (
    <box border title="keys" style={{ flexDirection: "column", padding: 1 }}>
      {(Object.keys(KEYMAP) as (Screen | "global")[]).map((k) => (
        <text key={k}>
          <span fg={theme.accent}>{k.padEnd(11)}</span>
          {KEYMAP[k]}
        </text>
      ))}
    </box>
  );
}

function Placeholder({ name }: { name: string }): ReactNode {
  const theme = useTheme();
  return (
    <box border style={{ flexGrow: 1 }}>
      <text fg={theme.muted}>{name} screen arrives with a later work order.</text>
    </box>
  );
}

export function App({ store, onQuit }: AppProps): ReactNode {
  const s = useTui(store);
  const { height } = useTerminalDimensions();
  useKeyboard((key) => {
    if (s.inputActive) {
      if (key.name === "escape") store.setInputActive(false);
      return;
    }
    if (key.name === "q" || (key.ctrl && key.name === "c")) return onQuit();
    if (key.name === "?" || (key.shift && key.name === "/")) return store.toggleHelp();
    if (key.name === "escape") return store.back();
    if (key.name === "r") return store.reload();
    const screen = SCREEN_KEYS[key.name];
    if (screen && SCREENS.includes(screen)) return store.setScreen(screen);
    if (s.screen === "matrix") {
      if (key.name === "j" || key.name === "down") store.move(1, 0);
      else if (key.name === "k" || key.name === "up") store.move(-1, 0);
      else if (key.name === "h" || key.name === "left") store.move(0, -1);
      else if (key.name === "l" || key.name === "right") store.move(0, 1);
      else if (key.name === "return") store.enter();
      else if (key.name === "s") store.cycleSort();
      else if (key.name === "c") store.toggleSummary();
      else if (key.name === "/") store.setInputActive(true);
      else if (key.name === "d") {
        const cell = store.selectedCell();
        if (!cell) return;
        if (s.diffWith && (s.diffWith.caseId !== cell.caseId || s.diffWith.targetId !== cell.targetId)) store.setScreen("diff");
        else store.setDiffWith({ caseId: cell.caseId, targetId: cell.targetId, trialIdx: 0 });
      }
    } else if (s.screen === "trace") {
      if (key.name === "]") store.nextTrial(1);
      else if (key.name === "[") store.nextTrial(-1);
    }
  });
  const body = s.help ? <HelpOverlay /> : s.screen === "matrix" ? <MatrixScreen store={store} /> : <Placeholder name={s.screen} />;
  return (
    <box style={{ flexDirection: "column", height, width: "100%" }}>
      <Header store={store} />
      {body}
      <Footer store={store} />
    </box>
  );
}
