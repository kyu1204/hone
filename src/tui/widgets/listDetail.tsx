import type { ReactNode } from "react";
import { useTheme } from "../theme";

export interface ListItem {
  id: string;
  label: string;
  badge?: string;
}

export interface ListDetailProps {
  title: string;
  items: ListItem[];
  selected: number;
  detail: ReactNode;
  empty?: string;
  detailTitle?: string;
}

/** Left: a selectable list with badges. Right: whatever the caller renders for the selection. */
export function ListDetail({ title, items, selected, detail, empty, detailTitle }: ListDetailProps): ReactNode {
  const theme = useTheme();
  if (items.length === 0) {
    return (
      <box border title={title} style={{ flexGrow: 1 }}>
        <text fg={theme.muted}>{empty ?? "nothing here yet"}</text>
      </box>
    );
  }
  const width = Math.max(12, ...items.map((i) => i.label.length)) + 2;
  return (
    <box style={{ flexGrow: 1, flexDirection: "row" }}>
      <box border title={title} style={{ width: Math.min(44, width + 8), flexDirection: "column" }}>
        <scrollbox style={{ flexGrow: 1 }} focused>
          {items.map((item, i) => (
            <text key={item.id} fg={i === selected ? theme.accent : theme.fg}>
              {(i === selected ? "▶ " : "  ") + item.label.padEnd(width)}
              {item.badge !== undefined ? <span fg={theme.muted}>{item.badge}</span> : null}
            </text>
          ))}
        </scrollbox>
      </box>
      <box border title={detailTitle ?? items[selected]?.label ?? ""} style={{ flexGrow: 1, flexDirection: "column" }}>
        <scrollbox style={{ flexGrow: 1 }}>{detail}</scrollbox>
      </box>
    </box>
  );
}
