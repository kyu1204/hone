import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import { ArgError, parseArgs, usageLine } from "../args";
import { storeRoot } from "./compare";
import type { CommandIo } from "./run";

export const TUI_SPEC = { flags: ["watch", "read-only"], strings: ["run"], numbers: [], repeatable: [] } as const;
const HELP: Record<string, string> = { watch: "poll the store every second (default on)", "read-only": "disable fork and edits", run: "run id (default: latest)" };

export function tuiUsage(): string {
  return `usage: hone tui [--run id] [--no-watch] [--read-only]\n\nOpen the dashboard over a run. Plain \`hone\` in a terminal does the same.\n\n${usageLine(TUI_SPEC, HELP)}\n`;
}

export async function tuiCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, TUI_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${tuiUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(tuiUsage());
    return 0;
  }
  if (!process.stdout.isTTY) {
    io.stderr("hone tui needs a terminal; use `hone run --json` or `hone matrix` in scripts\n");
    return 2;
  }
  const { createTuiStore } = await import("../../tui/state");
  const { App } = await import("../../tui/app");
  const store = createTuiStore({ root: await storeRoot(io), runId: args.values.run?.[0], watch: args.flags.watch !== false, readOnly: args.flags["read-only"] === true });
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  await new Promise<void>((resolve) => {
    const root = createRoot(renderer);
    root.render(
      createElement(App, {
        store,
        onQuit: () => {
          store.dispose();
          renderer.destroy();
          resolve();
        },
      }),
    );
  });
  return 0;
}
