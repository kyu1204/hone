// Pre-release gate: package version matches the tag (when given), CHANGELOG has a section for it, the tree is clean.
import * as fs from "node:fs";
import * as path from "node:path";

export interface ReleaseCheckInput {
  version: string;
  tag?: string;
  changelog: string;
  gitStatus: string;
}

export function releaseProblems(i: ReleaseCheckInput): string[] {
  const problems: string[] = [];
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(i.version)) problems.push(`package.json version ${i.version} is not semver`);
  if (i.tag !== undefined && i.tag !== `v${i.version}`) problems.push(`tag ${i.tag} does not match package.json version v${i.version}`);
  if (!new RegExp(`^## \\[?${i.version.replace(/\./g, "\\.")}\\]?( |$)`, "m").test(i.changelog)) problems.push(`CHANGELOG.md has no "## ${i.version}" section`);
  if (i.gitStatus.trim() !== "") problems.push(`working tree is not clean:\n${i.gitStatus.trim()}`);
  return problems;
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  const version = (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }).version;
  const tag = process.argv[2] ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
  const changelog = fs.existsSync(path.join(root, "CHANGELOG.md")) ? fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8") : "";
  const gitStatus = new TextDecoder().decode(Bun.spawnSync(["git", "status", "--porcelain"], { cwd: root }).stdout);
  const problems = releaseProblems({ version, tag, changelog, gitStatus });
  for (const p of problems) console.error(`release-check: ${p}`);
  console.log(problems.length ? `${problems.length} problem(s)` : `release-check: v${version} is ready${tag ? ` (tag ${tag})` : ""}`);
  process.exit(problems.length ? 1 : 0);
}
