// JUnit XML: one testcase per (case, target) cell, failing when the cell's pass@1 is below 1.
import type { Trial } from "../../core/types";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function junitXml(trials: Trial[], opts: { durationMs?: number; suite?: string } = {}): string {
  const byCell = new Map<string, Trial[]>();
  for (const t of trials) {
    const k = `${t.trace.caseId}\u0000${t.trace.targetId}`;
    (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(t);
  }
  const cases = [...byCell.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, ts]) => {
      const [caseId, targetId] = k.split("\u0000") as [string, string];
      const failed = ts.filter((t) => t.pass !== true);
      const reasons = failed.flatMap((t) => [t.trace.error, ...t.scores.filter((s) => s.pass === false).map((s) => `${s.scorer}: ${s.reason ?? "failed"}`)]).filter(Boolean).join("; ");
      const ms = ts.reduce((a, t) => a + Math.max(0, Date.parse(t.trace.endedAt) - Date.parse(t.trace.startedAt) || 0), 0);
      const body = failed.length ? `<failure message="${esc(`${failed.length}/${ts.length} trials failed: ${reasons}`)}"/>` : "";
      return { xml: `    <testcase classname="${esc(targetId)}" name="${esc(caseId)}" time="${(ms / 1000).toFixed(3)}">${body}</testcase>`, failed: failed.length > 0 };
    });
  const failures = cases.filter((c) => c.failed).length;
  const duration = opts.durationMs ?? trials.reduce((a, t) => a + Math.max(0, Date.parse(t.trace.endedAt) - Date.parse(t.trace.startedAt) || 0), 0);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="${esc(opts.suite ?? "hone")}" tests="${cases.length}" failures="${failures}" errors="0" time="${(duration / 1000).toFixed(3)}">\n${cases.map((c) => c.xml).join("\n")}\n  </testsuite>\n</testsuites>\n`;
}
