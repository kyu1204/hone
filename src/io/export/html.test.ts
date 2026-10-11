import { describe, expect, test } from "bun:test";
import valid from "../../../test/fixtures/trace.valid.json";
import type { Trace, Trial } from "../../core/types";
import { renderReport } from "./html";

const base = valid as Trace;
const mk = (caseId: string, pass: boolean): Trial => ({ id: `${caseId}-t-0`, runId: "r", trace: { ...base, id: caseId, caseId, targetId: "t" }, scores: [{ scorer: "exact", value: pass ? 1 : 0, pass, reason: pass ? "equal" : "mismatch <here>" }], flags: pass ? [] : ["reward-hack"], pass, costUsd: 0.01 });

describe("renderReport", () => {
  test("self-contained HTML with tiles, matrix, trial details, escaped text and no external assets", () => {
    const html = renderReport("run-1", [mk("alpha", true), mk("beta", false)], { totals: { passAt1: 0.5 } });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("run-1");
    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("reward-hack");
    expect(html).toContain("mismatch &lt;here&gt;");
    expect(html).toMatch(/pass@1<b>0\.50<\/b>/);
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href="https?:\/\/[^"]*\.(css|js)"/);
    expect(html).toContain("&quot;totals&quot;");
  });
});
