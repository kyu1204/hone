import { describe, expect, test } from "bun:test";
import valid from "../../../test/fixtures/trace.valid.json";
import type { Trace, Trial } from "../../core/types";
import { junitXml } from "./junit";

const base = valid as Trace;
const mk = (caseId: string, target: string, trial: number, pass: boolean, reason?: string): Trial => ({ id: `${caseId}-${target}-${trial}`, runId: "r", trace: { ...base, id: `${caseId}-${trial}`, caseId, targetId: target, trial }, scores: pass ? [{ scorer: "exact", value: 1, pass: true }] : [{ scorer: "exact", value: 0, pass: false, reason }], flags: [], pass, costUsd: 0 });

describe("junitXml", () => {
  test("one testcase per cell, failure message lists reasons, counts in the suite header", () => {
    const xml = junitXml([mk("a", "t", 0, true), mk("a", "t", 1, true), mk("b", "t", 0, false, "mismatch"), mk("b", "u", 0, true)], { durationMs: 1500, suite: "nightly" });
    expect(xml).toContain('<testsuite name="nightly" tests="3" failures="1" errors="0" time="1.500">');
    expect(xml).toContain('<testcase classname="t" name="a" time="');
    expect(xml).toMatch(/<testcase classname="t" name="b"[^>]*><failure message="1\/1 trials failed: exact: mismatch"\/><\/testcase>/);
    expect(xml).toContain('<testcase classname="u" name="b"');
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(junitXml([mk("x<y", "t", 0, false, 'a "quoted" <tag>')])).toContain('name="x&lt;y"');
    expect(junitXml([mk("x", "t", 0, false, 'a "quoted" <tag>')])).toContain("a &quot;quoted&quot; &lt;tag>");
  });
});
