// Checks the repository's live protection against the policy in docs/hardening.md: bun scripts/check-hardening.ts [owner/repo]
export interface Ruleset {
  name?: string;
  enforcement?: string;
  conditions?: { ref_name?: { include?: string[] } };
  rules?: { type: string; parameters?: Record<string, unknown> }[];
}
export interface RepoSettings {
  delete_branch_on_merge?: boolean;
  has_wiki?: boolean;
  has_projects?: boolean;
  security_and_analysis?: Record<string, { status?: string }>;
}
export interface Finding {
  check: string;
  ok: boolean;
  detail: string;
}

export function checkRuleset(r: Ruleset): Finding[] {
  const rules = new Map((r.rules ?? []).map((x) => [x.type, x.parameters ?? {}]));
  const pr = rules.get("pull_request") as { allowed_merge_methods?: string[] } | undefined;
  const checks = rules.get("required_status_checks") as { strict_required_status_checks_policy?: boolean; required_status_checks?: { context: string }[] } | undefined;
  return [
    { check: "ruleset active on the default branch", ok: r.enforcement === "active" && (r.conditions?.ref_name?.include ?? []).includes("~DEFAULT_BRANCH"), detail: `${r.enforcement ?? "?"} on ${(r.conditions?.ref_name?.include ?? []).join(",") || "?"}` },
    { check: "deletion blocked", ok: rules.has("deletion"), detail: rules.has("deletion") ? "yes" : "missing" },
    { check: "force push blocked", ok: rules.has("non_fast_forward"), detail: rules.has("non_fast_forward") ? "yes" : "missing" },
    { check: "pull request required, rebase/squash only", ok: !!pr && (pr.allowed_merge_methods ?? []).every((m) => m === "rebase" || m === "squash") && (pr.allowed_merge_methods ?? []).length > 0, detail: pr ? (pr.allowed_merge_methods ?? []).join(",") : "missing" },
    { check: "status check `check` required with strict updates", ok: !!checks && checks.strict_required_status_checks_policy === true && (checks.required_status_checks ?? []).some((c) => c.context === "check"), detail: checks ? `${(checks.required_status_checks ?? []).map((c) => c.context).join(",")} strict=${String(checks.strict_required_status_checks_policy)}` : "missing" },
  ];
}

export function checkSettings(s: RepoSettings): Finding[] {
  const sec = s.security_and_analysis ?? {};
  const on = (k: string): boolean => sec[k]?.status === "enabled";
  return [
    { check: "delete branch on merge", ok: s.delete_branch_on_merge === true, detail: String(s.delete_branch_on_merge) },
    { check: "wiki disabled", ok: s.has_wiki === false, detail: String(s.has_wiki) },
    { check: "projects disabled", ok: s.has_projects === false, detail: String(s.has_projects) },
    { check: "secret scanning", ok: on("secret_scanning"), detail: sec.secret_scanning?.status ?? "?" },
    { check: "push protection", ok: on("secret_scanning_push_protection"), detail: sec.secret_scanning_push_protection?.status ?? "?" },
    { check: "dependabot security updates", ok: on("dependabot_security_updates"), detail: sec.dependabot_security_updates?.status ?? "?" },
  ];
}

export function renderFindings(findings: Finding[]): string {
  return `${findings.map((f) => `${f.ok ? "ok  " : "FAIL"}  ${f.check.padEnd(50)} ${f.detail}`).join("\n")}\n`;
}

if (import.meta.main) {
  const repo = process.argv[2] ?? "kyu1204/hone";
  const api = (p: string): unknown => JSON.parse(new TextDecoder().decode(Bun.spawnSync(["gh", "api", p]).stdout));
  const rulesets = api(`repos/${repo}/rulesets`) as { id: number; name: string }[];
  const main = rulesets.find((r) => r.name === "protect-main") ?? rulesets[0];
  const findings = [...(main ? checkRuleset(api(`repos/${repo}/rulesets/${main.id}`) as Ruleset) : [{ check: "ruleset exists", ok: false, detail: "no rulesets" }]), ...checkSettings(api(`repos/${repo}`) as RepoSettings)];
  process.stdout.write(`${repo} (${new Date().toISOString().slice(0, 10)})\n${renderFindings(findings)}`);
  process.exit(findings.every((f) => f.ok) ? 0 : 1);
}
