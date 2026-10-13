import { guide, TOPICS } from "../skill";
import type { CommandIo } from "./run";

export function guideUsage(): string {
  return `usage: hone guide [topic]\n\nPrint the skill that \`hone init\` installs for coding agents, or one topic of it: ${TOPICS.join(", ")}.\n`;
}

export async function guideCommand(argv: string[], io: CommandIo): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout(guideUsage());
    return 0;
  }
  const text = guide(argv[0]);
  if (text === undefined) {
    io.stderr(`unknown topic "${argv[0]}". Topics: ${TOPICS.join(", ")}\n`);
    return 2;
  }
  io.stdout(text.endsWith("\n") ? text : `${text}\n`);
  return 0;
}
