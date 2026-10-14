#!/usr/bin/env bun
import { ablateCommand } from "./cli/commands/ablate";
import { bisectCommand } from "./cli/commands/bisect";
import { calibrateCommand } from "./cli/commands/calibrate";
import { ciCommand } from "./cli/commands/ci";
import { clusterCommand } from "./cli/commands/cluster";
import { compareCommand } from "./cli/commands/compare";
import { diffCommand } from "./cli/commands/diff";
import { draftCommand } from "./cli/commands/draft";
import { evolveCommand } from "./cli/commands/evolve";
import { explainCommand } from "./cli/commands/explain";
import { exportCommand } from "./cli/commands/export";
import { forkCommand } from "./cli/commands/fork";
import { guideCommand } from "./cli/commands/guide";
import { importCommand } from "./cli/commands/import";
import { initCommand } from "./cli/commands/init";
import { matrixCommand } from "./cli/commands/matrix";
import { optimizeCommand } from "./cli/commands/optimize";
import { powerCommand } from "./cli/commands/power";
import { type CommandIo, runCommand } from "./cli/commands/run";
import { serveCommand } from "./cli/commands/serve";
import { sharpenCommand } from "./cli/commands/sharpen";
import { tuiCommand } from "./cli/commands/tui";
import { VERSION } from "./index";

type Command = (argv: string[], io: CommandIo) => Promise<number>;
type Group = Record<string, { run: Command; summary: string }>;

// What a newcomer needs. Everything else is one step of these, a way to look at results, or a tool: `hone help all`.
const EVERYDAY: Group = {
  init: { run: initCommand, summary: "set up: detect the project, write hone.config.ts and example cases" },
  draft: { run: draftCommand, summary: "write cases: hone's model drafts them from the agent's prompt and code, runs them, says which fail" },
  // `hone test --ci` is the gate for pipelines: thresholds per axis, JUnit, a pull request comment
  test: { run: (argv, io) => (argv.includes("--ci") ? ciCommand(argv.filter((a) => a !== "--ci"), io) : runCommand(argv, io)), summary: "evaluate: run every case, score it, say how far to trust the score" },
  sharpen: { run: sharpenCommand, summary: "improve: find why cases fail, try changes, re-test, keep what is proven" },
};

const MORE: [string, Group][] = [
  [
    "steps that `hone sharpen` runs for you",
    {
      cluster: { run: clusterCommand, summary: "group the failed trials into failure modes and name them" },
      calibrate: { run: calibrateCommand, summary: "check a judge: plant known faults in passing trials and count what it catches" },
      evolve: { run: evolveCommand, summary: "rewrite one text from the failures and keep the versions that test better" },
      optimize: { run: optimizeCommand, summary: "spend a fixed number of trials across the declared candidates and pick the best" },
      ablate: { run: ablateCommand, summary: "remove one part of the config at a time and measure what it was worth" },
      compare: { run: compareCommand, summary: "say whether two targets (or two runs) really differ, case by case" },
      power: { run: powerCommand, summary: "how many cases a difference of a given size needs" },
    },
  ],
  [
    "looking at results",
    {
      tui: { run: tuiCommand, summary: "browse the results in the terminal (plain `hone` does the same)" },
      matrix: { run: matrixCommand, summary: "one row per target: pass rate, cost, time, and which targets really differ" },
      explain: { run: explainCommand, summary: "print one trial: verdict, scores, messages" },
      diff: { run: diffCommand, summary: "show where two trials went different ways" },
      fork: { run: forkCommand, summary: "re-run a trial from an edited step and compare the verdict" },
    },
  ],
  [
    "other tools",
    {
      bisect: { run: bisectCommand, summary: "find the commit that broke a case" },
      export: { run: exportCommand, summary: "write trials as JSONL for training, OpenTelemetry, Docent, JUnit or HTML" },
      import: { run: importCommand, summary: "bring Claude Code sessions and other tools' results in" },
      serve: { run: serveCommand, summary: "serve the dashboard over SSH, the scorers as a reward API, or MCP tools for agents" },
      guide: { run: guideCommand, summary: "print the skill for coding agents, or one topic of it" },
    },
  ],
];

const COMMANDS: Group = Object.assign({}, EVERYDAY, ...MORE.map(([, g]) => g));
const WIDTH = Math.max(...Object.keys(COMMANDS).map((c) => c.length)) + 2;
const table = (g: Group): string => Object.entries(g).map(([name, c]) => `  ${name.padEnd(WIDTH)}${c.summary}`).join("\n");

/** Every command the CLI accepts. */
export function commandNames(): string[] {
  return Object.keys(COMMANDS);
}

export function usage(): string {
  return `hone ${VERSION}\n\nusage: hone <command> [options]\n\n${table(EVERYDAY)}\n\nhone                    browse the results (in a terminal)\nhone help all           the single steps behind these, and other tools\nhone <command> --help   the options of one command\n`;
}

export function usageAll(): string {
  return `hone ${VERSION}\n\nusage: hone <command> [options]\n\n${table(EVERYDAY)}\n\n${MORE.map(([title, g]) => `${title}\n${table(g)}`).join("\n\n")}\n\nhone <command> --help   the options of one command\n`;
}

export async function main(argv: string[]): Promise<number> {
  const io: CommandIo = { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), cwd: process.cwd(), env: process.env };
  const [name, ...rest] = argv;
  if (!name && process.stdout.isTTY && process.stdin.isTTY) return tuiCommand([], io);
  if (!name || name === "--help" || name === "-h" || name === "help") {
    io.stdout(rest[0] === "all" ? usageAll() : usage());
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
