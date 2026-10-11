#!/usr/bin/env bun
import { ablateCommand } from "./cli/commands/ablate";
import { bisectCommand } from "./cli/commands/bisect";
import { ciCommand } from "./cli/commands/ci";
import { compareCommand } from "./cli/commands/compare";
import { explainCommand } from "./cli/commands/explain";
import { initCommand } from "./cli/commands/init";
import { matrixCommand } from "./cli/commands/matrix";
import { powerCommand } from "./cli/commands/power";
import { reportCommand } from "./cli/commands/report";
import { type CommandIo, runCommand } from "./cli/commands/run";
import { VERSION } from "./index";

type Command = (argv: string[], io: CommandIo) => Promise<number>;

const COMMANDS: Record<string, { run: Command; summary: string }> = {
  power: { run: powerCommand, summary: "cases needed for an effect, or the smallest detectable effect" },
  report: { run: reportCommand, summary: "write a self-contained HTML report for a run" },
  run: { run: runCommand, summary: "run every case against every target and summarise" },
  ci: { run: ciCommand, summary: "run and gate per axis for CI; writes JUnit and a PR comment" },
  compare: { run: compareCommand, summary: "paired comparison of two targets (or runs) with significance" },
  ablate: { run: ablateCommand, summary: "measure what each config component contributes" },
  bisect: { run: bisectCommand, summary: "find the commit that broke a case, with confidence intervals" },
  explain: { run: explainCommand, summary: "print one trial: verdict, scores, messages, spans" },
  init: { run: initCommand, summary: "detect the project and write hone.config.ts, example cases and keys" },
  matrix: { run: matrixCommand, summary: "per-target solve rate, cost, tokens, time and significance bands" },
};

export function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((c) => c.length)) + 2;
  return `hone ${VERSION}\n\nusage: hone <command> [options]\n\ncommands:\n${Object.entries(COMMANDS)
    .map(([name, c]) => `  ${name.padEnd(width)}${c.summary}`)
    .join("\n")}\n\nhone <command> --help for options.\n`;
}

export async function main(argv: string[]): Promise<number> {
  const io: CommandIo = { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), cwd: process.cwd(), env: process.env };
  const [name, ...rest] = argv;
  if (!name || name === "--help" || name === "-h") {
    io.stdout(usage());
    return 0;
  }
  if (name === "--version" || name === "-v") {
    io.stdout(`hone ${VERSION}\n`);
    return 0;
  }
  const cmd = COMMANDS[name];
  if (!cmd) {
    io.stderr(`unknown command "${name}"\n\n${usage()}`);
    return 2;
  }
  return cmd.run(rest, io);
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      process.exit(2);
    },
  );
}
