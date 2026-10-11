import { describe, expect, test } from "bun:test";
import ruleset from "../test/fixtures/ruleset.protect-main.json";
import { checkRuleset, checkSettings, renderFindings } from "./check-hardening";

describe("check-hardening", () => {
  test("the recorded protect-main ruleset passes every rule check", () => {
    const findings = checkRuleset(ruleset);
    expect(findings.every((f) => f.ok)).toBe(true);
    expect(findings.map((f) => f.check)).toHaveLength(5);
  });
  test("a weaker ruleset is flagged", () => {
    const weak = { ...ruleset, enforcement: "disabled", rules: ruleset.rules.filter((r) => r.type !== "non_fast_forward") };
    const bad = checkRuleset(weak).filter((f) => !f.ok).map((f) => f.check);
    expect(bad).toEqual(["ruleset active on the default branch", "force push blocked"]);
  });
  test("settings checks and rendering", () => {
    const good = checkSettings({ delete_branch_on_merge: true, has_wiki: false, has_projects: false, security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" }, dependabot_security_updates: { status: "enabled" } } });
    expect(good.every((f) => f.ok)).toBe(true);
    const bad = checkSettings({ has_wiki: true });
    expect(bad.filter((f) => f.ok)).toEqual([]);
    expect(renderFindings(good)).toMatch(/^ok {4}delete branch on merge/);
    expect(renderFindings(bad)).toMatch(/FAIL {2}wiki disabled/);
  });
});
