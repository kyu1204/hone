// One diagnostic session with the benchmark's exact invocation, in a copy of a task workspace placed where the real
// runs put theirs, next to a sibling workspace of another task. Shows what the agent can run, read and reach.
// Usage: bun probe.ts [taskId] [model]
import * as fs from "node:fs";
import * as path from "node:path";
import { parseClaudeStream } from "../../src/targets/parsers/claudeCode";
import { AGENT_PATH, BASE_ARGV, PRIVATE, TASKS, WORK } from "./bench.ts";

// the operator's real checkout and Claude Code's per-session temp directory for it: both must be unreadable from a task
const REPO = path.resolve(import.meta.dir, "../..");
const CC_TMP = `/private/tmp/claude-${process.getuid?.() ?? 501}`;
const task = process.argv[2] ?? "matrix-errors";
const model = process.argv[3] ?? "sonnet";
const copy = (id: string): string => {
  const dir = fs.mkdtempSync(path.join(WORK, "hone-ws-"));
  fs.cpSync(`${TASKS}/${id}`, dir, { recursive: true, filter: (s) => path.basename(s) !== "node_modules" });
  fs.symlinkSync(fs.realpathSync(`${TASKS}/${id}/node_modules`), path.join(dir, "node_modules"));
  return dir;
};
const ws = copy(task);
const sibling = copy("embed-provider");
const sib = path.basename(sibling);
const commands = [
  "pwd; bun test src/core 2>&1 | tail -3",
  `ls .. 2>&1 | head -3; ls ../${sib} 2>&1 | head -2; cat ../${sib}/package.json 2>&1 | head -2`,
  `ls ${TASKS} 2>&1 | head -2; ls ${PRIVATE}/hidden 2>&1 | head -2; ls ${REPO} 2>&1 | head -2`,
  `ls ${CC_TMP}/ 2>&1 | head -3; ls ${CC_TMP}/${REPO.replaceAll("/", "-")} 2>&1 | head -3`,
  "ls node_modules | head -2; git status --short | head -3; git log --oneline | head -2; ls /private/tmp/hone-bench/agent-harness",
  `find /private/tmp /private/var/folders ${PRIVATE} -name "embed.test.ts" -not -path "*/node_modules/*" 2>/dev/null | head -5; echo find-done`,
  'curl -sS -m 8 -o /dev/null -w "%{http_code}\\n" https://github.com 2>&1 | tail -1; echo ok > probe.txt && echo wrote',
];
const prompt = `This is an environment check, not a coding task. Run each of the following commands with the Bash tool, one call per command, exactly as written, in this order. Do not fix, retry or work around anything that fails.\n${commands.map((c, i) => `${i + 1}. ${c}`).join("\n")}\nThen call the Read tool once on ${sibling}/package.json and the Glob tool once with pattern "**/*.test.ts" and path ${sibling}. Then reply with the single word DONE.`;
const argv = [...BASE_ARGV, "--model", model].map((a) => a.replaceAll("{prompt}", prompt));
const proc = Bun.spawn(argv, { cwd: ws, env: { ...process.env, PATH: AGENT_PATH, TMPDIR: WORK }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
const p = parseClaudeStream(stdout);
console.log(`exit ${code} | stderr: ${stderr.trim().slice(0, 200)} | own workspace: ${path.basename(ws)} | sibling: ${sib}`);
console.log(`meta: ${JSON.stringify({ v: p.meta.claudeCodeVersion, mode: p.meta.permissionMode, tools: p.meta.toolCount, mcp: p.meta.mcpServers, hooks: p.meta.hooks, turns: p.meta.numTurns, rateLimit: p.meta.rateLimit })}`);
console.log(`usage: ${JSON.stringify(p.usage)}`);
for (const s of p.spans) {
  const input = s.input as { command?: string; file_path?: string; pattern?: string; path?: string };
  console.log(`\n$ [${s.name}] ${String(input?.command ?? input?.file_path ?? `${input?.pattern} in ${input?.path}`).slice(0, 120)}\n${String(s.output ?? "").trim().split("\n").slice(0, 8).join("\n").slice(0, 600)}`);
}
console.log(`\nfinal: ${String(p.output).slice(0, 80)} | probe.txt written: ${fs.existsSync(path.join(ws, "probe.txt"))}`);
fs.rmSync(ws, { recursive: true, force: true });
fs.rmSync(sibling, { recursive: true, force: true });
