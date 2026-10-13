import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { JevClient, noul } from "../../providers/jev";
import skillSource from "../../../skills/hone/SKILL.md" with { type: "text" };
import { ArgError, parseArgs, usageLine } from "../args";
import { detectProject, renderCases, renderConfig } from "../detect";
import type { CommandIo } from "./run";

export const INIT_SPEC = {
  flags: ["yes", "keys", "force", "skills"],
  strings: ["typesafe-key", "openrouter-key", "anthropic-key", "openai-key"],
  numbers: [],
  repeatable: [],
} as const;

const HELP: Record<string, string> = {
  yes: "no prompts; accept detection and skip interactive key entry",
  keys: "ask for API keys (default on; --no-keys to skip)",
  force: "overwrite an existing hone.config.ts (and an installed skill)",
  skills: "install the hone skill into .claude/skills (and .codex/skills when .codex exists); alone, installs only the skill",
  "typesafe-key": "TYPESAFE_API_KEY to store",
  "openrouter-key": "OPENROUTER_API_KEY to store",
  "anthropic-key": "ANTHROPIC_API_KEY to store",
  "openai-key": "OPENAI_API_KEY to store",
};

export function initUsage(): string {
  return `usage: hone init [options]\n\nDetect the project, write hone.config.ts and example cases, store API keys.\n\n${usageLine(INIT_SPEC, HELP)}\n`;
}

function ask(question: string): string {
  if (!process.stdin.isTTY) return "";
  const answer = prompt(question);
  return (answer ?? "").trim();
}

export function writeEnvFile(home: string, vars: Record<string, string>): string {
  const dir = path.join(home, ".config", "hone");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "env");
  const existing: Record<string, string> = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) existing[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  const merged = { ...existing, ...vars };
  fs.writeFileSync(file, `${Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n")}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

export async function initCommand(argv: string[], io: CommandIo): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, INIT_SPEC);
  } catch (e) {
    io.stderr(`${e instanceof ArgError ? e.message : String(e)}\n${initUsage()}`);
    return 2;
  }
  if (args.help) {
    io.stdout(initUsage());
    return 0;
  }
  const configPath = path.join(io.cwd, "hone.config.ts");
  if (args.flags.skills && fs.existsSync(configPath) && !args.flags.force) {
    installSkills(io, false);
    return 0;
  }
  if (fs.existsSync(configPath) && !args.flags.force) {
    io.stderr(`${configPath} already exists; pass --force to overwrite it\n`);
    return 2;
  }
  const detection = detectProject(io.cwd);
  io.stdout(detection.signals.length ? `detected: ${detection.signals.join(", ")}\n` : "nothing detected; writing a minimal echo setup\n");

  const importFrom = io.env.HONE_CONFIG_IMPORT ?? "hone-eval";
  fs.writeFileSync(configPath, renderConfig(detection, importFrom));
  fs.mkdirSync(path.join(io.cwd, "evals"), { recursive: true });
  fs.writeFileSync(path.join(io.cwd, "evals", "cases.yaml"), renderCases(detection.cases));
  for (const [rel, content] of Object.entries(detection.files)) {
    const f = path.join(io.cwd, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (!fs.existsSync(f) || args.flags.force) fs.writeFileSync(f, content);
  }
  const gitignore = path.join(io.cwd, ".gitignore");
  const current = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
  if (!/^\.hone\/?$/m.test(current)) fs.writeFileSync(gitignore, `${current}${current && !current.endsWith("\n") ? "\n" : ""}.hone/\n`);
  io.stdout(`wrote hone.config.ts, evals/cases.yaml${Object.keys(detection.files).length ? `, ${Object.keys(detection.files).join(", ")}` : ""}\n`);
  for (const n of detection.notes) io.stdout(`note: ${n}\n`);

  if (args.flags.keys !== false) {
    const vars: Record<string, string> = {};
    const given = { TYPESAFE_API_KEY: args.values["typesafe-key"]?.[0], OPENROUTER_API_KEY: args.values["openrouter-key"]?.[0], ANTHROPIC_API_KEY: args.values["anthropic-key"]?.[0], OPENAI_API_KEY: args.values["openai-key"]?.[0] };
    for (const [k, v] of Object.entries(given)) if (v) vars[k] = v;
    if (Object.keys(vars).length === 0 && !args.flags.yes) {
      io.stdout("API keys are stored in ~/.config/hone/env (0600). Press enter to skip any of them.\n");
      const jev = ask("TypeSafe Jev key (TYPESAFE_API_KEY), or an OpenRouter key (sk-or-...): ");
      if (jev) {
        const name = jev.startsWith("sk-or-") ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY";
        try {
          const client = new JevClient({ provider: { apiKey: jev, endpoint: name === "OPENROUTER_API_KEY" ? "https://openrouter.ai/api/v1/systemone" : "https://api.typesafe.ai/v1/systemone", model: name === "OPENROUTER_API_KEY" ? "~typesafe/jev-latest" : "jev-latest" }, maxRetries: 0 });
          await client.ask("ping", { ok: noul("Is the state the word ping?") });
          io.stdout("Jev key works.\n");
        } catch (e) {
          io.stderr(`Jev key check failed (${e instanceof Error ? e.message : String(e)}); storing it anyway.\n`);
        }
        vars[name] = jev;
      }
      const llm = ask("Anthropic key (sk-ant-...) or OpenAI key (sk-...) for generative judges: ");
      if (llm) vars[llm.startsWith("sk-ant-") ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"] = llm;
    }
    if (Object.keys(vars).length) {
      const file = writeEnvFile(io.env.HOME ?? os.homedir(), vars);
      io.stdout(`stored ${Object.keys(vars).join(", ")} in ${file}\n`);
    }
  }
  if (args.flags.skills) installSkills(io, args.flags.force === true);
  io.stdout("\nnext: hone test\n");
  return 0;
}

/** Copies the embedded skills/hone/SKILL.md into .claude/skills/hone (and .codex/skills/hone when .codex exists). */
export function installSkills(io: CommandIo, force: boolean): string[] {
  const roots = [".claude", ...(fs.existsSync(path.join(io.cwd, ".codex")) ? [".codex"] : [])];
  const written: string[] = [];
  for (const root of roots) {
    const file = path.join(io.cwd, root, "skills", "hone", "SKILL.md");
    if (fs.existsSync(file) && !force) {
      io.stdout(`kept existing ${path.relative(io.cwd, file)} (pass --force to replace it)\n`);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, skillSource);
    written.push(file);
    io.stdout(`installed skill ${path.relative(io.cwd, file)}\n`);
  }
  return written;
}
