import { describe, expect, test } from "bun:test";
import valid from "../../test/fixtures/trace.valid.json";
import type { ChatMessage, Trace, Trial } from "../core/types";
import { pickSibling, rankBranchPoints, topSteps } from "./branchpoints";

const base = valid as Trace;
const a = (c: string, tools: string[] = []): ChatMessage => ({ role: "assistant", content: c, ...(tools.length ? { tool_calls: tools.map((t, i) => ({ id: `${t}${i}`, type: "function" as const, function: { name: t, arguments: "{}" } })) } : {}) });
const t = (id: string, name: string, c = "ok"): ChatMessage => ({ role: "tool", name, tool_call_id: id, content: c });
const mk = (id: string, caseId: string, messages: ChatMessage[], pass: boolean, spans: Trace["spans"] = []): Trial => ({ id, runId: "r", trace: { ...base, id, caseId, targetId: id, messages, spans }, scores: [], flags: [], pass, costUsd: 0 });

// 0 user, 1 assistant→Read, 2 tool Read, 3 assistant→Bash, 4 tool Bash, 5 assistant→Edit, 6 tool Edit, 7 assistant done
const failed = mk("f", "c", [{ role: "user", content: "fix" }, a("", ["Read"]), t("Read0", "Read", "file"), a("", ["Bash"]), t("Bash0", "Bash", "2 failed"), a("", ["Edit"]), t("Edit0", "Edit", "ok"), a("Fixed, done.")], false);
// sibling re-runs the tests after editing
const sibling = mk("s", "c", [{ role: "user", content: "fix" }, a("", ["Read"]), t("Read0", "Read", "file"), a("", ["Bash"]), t("Bash0", "Bash", "2 failed"), a("", ["Edit"]), t("Edit0", "Edit", "ok"), a("", ["Bash"]), t("Bash1", "Bash", "all passed"), a("Fixed and verified.")], true);

describe("rankBranchPoints", () => {
  test("with a passing sibling: the divergence and the completion claim rank first", () => {
    const ranked = rankBranchPoints(failed, sibling);
    expect(ranked[0]).toMatchObject({ step: 7 });
    expect(ranked[0]!.reasons.join(" ")).toMatch(/diverges from passing sibling/);
    expect(ranked[0]!.reasons.join(" ")).toMatch(/claims completion/);
    expect(ranked.find((r) => r.step === 5)!.reasons.join(" ")).toMatch(/last tool call/);
    expect(ranked.every((r, i) => i === 0 || ranked[i - 1]!.score >= r.score)).toBe(true);
    expect(ranked.find((r) => r.step === 0)).toBeUndefined();
    const early = mk("s2", "c", [{ role: "user", content: "fix" }, a("", ["Write"]), t("Write0", "Write"), a("Fixed and verified.")], true);
    const r1 = rankBranchPoints(failed, early).find((r) => r.step === 1)!;
    expect(r1.score).toBe(2);
    expect(r1.reasons.join(" ")).toMatch(/early in the trace/);
  });

  test("a swapped tool result and an error span add signals at that step", () => {
    const swapped = mk("f2", "c", failed.trace.messages.map((m, i) => (i === 2 ? { ...m, content: "different file" } : m)), false, [{ id: "sp", kind: "tool", name: "Bash", startedAt: base.startedAt, attrs: { error: "exit 1" } }]);
    const ranked = rankBranchPoints(swapped, sibling);
    const step2 = ranked.find((r) => r.step === 2)!;
    expect(step2.reasons.join(" ")).toMatch(/tool result differs/);
    const step4 = ranked.find((r) => r.step === 4)!;
    expect(step4.reasons.join(" ")).toMatch(/error/);
    expect(step4.score).toBeGreaterThanOrEqual(3);
  });

  test("without a sibling only local signals apply; topSteps keeps the best three", () => {
    const ranked = rankBranchPoints(failed);
    expect(ranked.map((r) => r.step)).toEqual([7, 5]);
    expect(ranked.every((r) => !r.reasons.some((x) => /sibling/.test(x)))).toBe(true);
    expect(topSteps(rankBranchPoints(failed, sibling), 3)).toEqual([7, 5]);
    expect(topSteps([], 3)).toEqual([]);
  });

  test("pickSibling prefers a passing trial of the same case", () => {
    const other = mk("o", "other", [], true);
    expect(pickSibling(failed, [failed, other, sibling])).toBe(sibling);
    expect(pickSibling(failed, [failed, other])).toBeUndefined();
    expect(pickSibling(sibling, [failed, sibling])).toBeUndefined();
  });
});
