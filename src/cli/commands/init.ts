import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { JevClient, noul } from "../../providers/jev";
import { ArgError, parseArgs, usageLine } from "../args";
import { detectProject, renderCases, renderConfig } from "../detect";
import { SKILL_FILES } from "../skill";
import type { CommandIo } from "./run";

export const INIT_SPEC = {
  flags: ["yes", "keys", "force", "agents", "skills"],
  strings: ["typesafe-key", "openrouter-key", "anthropic-key", "openai-key"],
  numbers: [],
  repeatable: [],
} as const;

const HELP: Record<string, string> = {
  yes: "no prompts; accept detection and skip interactive key entry",
  keys: "ask for API keys (default on; --no-keys to skip)",
  force: "overwrite an existing hone.config.ts (and an installed skill)",
  agents: "install the skill and register the MCP server for coding agents (default on; --no-agents to skip)",
  skills: "install only the skill, into a project that already has a config",
  "typesafe-key": "TYPESAFE_API_KEY to store",
  "openrouter-key": "OPENROUTER_API_KEY to store",
  "anthropic-key": "ANTHROPIC_API_KEY to store",
  "openai-key": "OPENAI_API_KEY to store",
};

export function initUsage(): string {
  return `usage: hone init [options]\n\nDetect the project; write hone.config.ts, example cases and a sharpen/ directory; store API keys; install the skill and register the MCP server for coding agents. Then hone draft drafts the cases.\n\n${usageLine(INIT_SPEC, HELP)}\n`;
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
    installSkills(io);
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
  const readme = path.join(io.cwd, "sharpen", "README.md");
  if (!fs.existsSync(readme)) {
    fs.mkdirSync(path.dirname(readme), { recursive: true });
    fs.writeFileSync(readme, SHARPEN_README);
  }
  const gitignore = path.join(io.cwd, ".gitignore");
  const current = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
  if (!/^\.hone\/?$/m.test(current)) fs.writeFileSync(gitignore, `${current}${current && !current.endsWith("\n") ? "\n" : ""}.hone/\n`);
  io.stdout(`wrote hone.config.ts, evals/cases.yaml, sharpen/README.md${Object.keys(detection.files).length ? `, ${Object.keys(detection.files).join(", ")}` : ""}\n`);
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
  if (args.flags.agents !== false) {
    installSkills(io);
    registerMcp(io);
  }
  io.stdout("\nnext: hone test, then hone sharpen\n");
  return 0;
}

/** Writes the skill and its references into `.agents/skills/hone` and `.claude/skills/hone`, replacing what is there: the files are hone's. */
export function installSkills(io: CommandIo): void {
  const dirs = [".agents", ".claude"].map((root) => path.join(root, "skills", "hone"));
  for (const dir of dirs) {
    for (const [rel, content] of Object.entries(SKILL_FILES)) {
      const file = path.join(io.cwd, dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  io.stdout(`installed the hone skill in ${dirs.join(" and ")}\n`);
}

// the bare name `hone` on npm is another package, so the server is started through the package name
const MCP_ENTRY = { command: "bunx", args: ["hone-eval", "serve", "mcp"] };

/** Registers the MCP server as `hone` for Claude Code (`.mcp.json`) and, in a project that uses it, Cursor. Other servers and an existing `hone` entry are left as they are. */
export function registerMcp(io: CommandIo): void {
  const files = [".mcp.json", ...(fs.existsSync(path.join(io.cwd, ".cursor")) ? [path.join(".cursor", "mcp.json")] : [])];
  for (const rel of files) {
    const file = path.join(io.cwd, rel);
    let doc: { mcpServers?: Record<string, unknown> } = {};
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
        doc = parsed as typeof doc;
      } catch {
        io.stdout(`could not read ${rel}; register the server by hand: claude mcp add hone -- ${MCP_ENTRY.command} ${MCP_ENTRY.args.join(" ")}\n`);
        continue;
      }
    }
    if (doc.mcpServers && typeof doc.mcpServers === "object" && "hone" in doc.mcpServers) {
      io.stdout(`the hone MCP server is already registered in ${rel}\n`);
      continue;
    }
    fs.writeFileSync(file, `${JSON.stringify({ ...doc, mcpServers: { ...doc.mcpServers, hone: MCP_ENTRY } }, null, 2)}\n`);
    io.stdout(`registered the hone MCP server in ${rel}\n`);
  }
}

const SHARPEN_README = `# sharpen/

Changes for \`hone sharpen\` to try: one idea per file, with the reason. A person writes them, or a coding agent that
read why cases fail (\`hone sharpen --budget 0\` names that page).

\`\`\`ts
// sharpen/first-idea.ts
import { change } from "hone-eval";

change("what it does", {
  why: "which failure it fixes, and why",
  add: "one rule for the text",            // a paragraph added to the text declared in sharpen.text
  // text: "the whole new text",           // or a new version of the whole text
  // config: (config) => ({ ...config }),  // or a change to the config: a setting, a model, new code
});
\`\`\`

Additions that help are stacked into one text, so two rules are two changes. Never edit a file the current system
runs. Put new code in a new file and point \`config\` at it.
`;
