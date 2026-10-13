// Merges the batch runs listed in runs.json and reports per target and paired between targets, with hone's own
// statistics (Wilson intervals, paired t / exact McNemar). Usage: bun analyze.ts [--runs runs.json] [--out results] [--json]
import * as fs from "node:fs";
import { Store } from "../../src/core/store";
import type { Trial } from "../../src/core/types";
import { wilsonCi } from "../../src/stats/interval";
import { compareTargets } from "../../src/stats/paired";
import { containment } from "./bench.ts";

const here = import.meta.dir;
const opt = (name: string, fallback: string): string => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1]! : fallback);
const runsFile = opt("--runs", "runs.json");
const outDir = `${here}/${opt("--out", "results")}`;
const runs = JSON.parse(fs.readFileSync(`${here}/${runsFile}`, "utf8")) as { target: string; cases: string[]; runId: string }[];
const cases = JSON.parse(fs.readFileSync(`${here}/cases.json`, "utf8")) as { id: string; tags: string[] }[];
const kindOf = new Map(cases.map((c) => [c.id, c.tags[0]!]));
const splitOf = new Map(cases.map((c) => [c.id, c.tags[1]!]));

interface Row {
  target: string;
  caseId: string;
  kind: string;
  split: string;
  resolved: boolean;
  f2p: number;
  contained: number;
  ranTests: number;
  wroteTests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  seconds: number;
  turns: number;
  error?: string;
  reason: string;
}
const store = new Store(`${here}/.hone`);
const rows: Row[] = [];
for (const r of runs) {
  for (const t of store.queryTrials({ runId: r.runId }) as Trial[]) {
    const score = (name: string) => t.scores.find((s) => s.scorer === name);
    rows.push({
      target: t.trace.targetId, caseId: t.trace.caseId, kind: kindOf.get(t.trace.caseId)!, split: splitOf.get(t.trace.caseId)!,
      resolved: score("resolved")?.pass === true && !t.trace.error, f2p: score("resolved")?.value ?? 0,
      contained: containment({ trace: t.trace } as Parameters<typeof containment>[0]).value, ranTests: score("ran-tests")?.value ?? 0, wroteTests: score("wrote-tests")?.value ?? 0,
      tokensIn: t.trace.usage.inputTokens, tokensOut: t.trace.usage.outputTokens, costUsd: t.costUsd,
      seconds: (Date.parse(t.trace.endedAt) - Date.parse(t.trace.startedAt)) / 1000, turns: Number(t.trace.meta?.numTurns ?? 0),
      ...(t.trace.error ? { error: t.trace.error } : {}), reason: score("resolved")?.reason ?? "",
    });
  }
}
store.close();

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const targets = [...new Set(rows.map((r) => r.target))];
const byCase = (rs: Row[]): Map<string, Row[]> => {
  const m = new Map<string, Row[]>();
  for (const r of rs) (m.get(r.caseId) ?? m.set(r.caseId, []).get(r.caseId)!).push(r);
  return m;
};

function summary(rs: Row[]) {
  const n = rs.length;
  const k = rs.filter((r) => r.resolved).length;
  const ci = n ? wilsonCi(k, n) : { lo: 0, hi: 1 };
  const perCase = [...byCase(rs).values()];
  return {
    cases: perCase.length, trials: n, resolved: k, rate: n ? k / n : 0, lo: ci.lo, hi: ci.hi,
    allTrials: perCase.filter((c) => c.every((r) => r.resolved)).length, anyTrial: perCase.filter((c) => c.some((r) => r.resolved)).length,
    f2p: mean(rs.map((r) => r.f2p)), tokensIn: mean(rs.map((r) => r.tokensIn)), tokensOut: mean(rs.map((r) => r.tokensOut)), cost: mean(rs.map((r) => r.costUsd)),
    costPerSolve: k ? rs.reduce((a, r) => a + r.costUsd, 0) / k : null, seconds: mean(rs.map((r) => r.seconds)), turns: mean(rs.map((r) => r.turns)),
    ranTests: mean(rs.map((r) => r.ranTests)), wroteTests: mean(rs.map((r) => r.wroteTests)), leftTask: rs.filter((r) => r.contained === 0).length, errors: rs.filter((r) => r.error).length,
  };
}

function paired(a: string, b: string, filter: (r: Row) => boolean, metric: "resolved" | "f2p") {
  const A = byCase(rows.filter((r) => r.target === a && filter(r)));
  const B = byCase(rows.filter((r) => r.target === b && filter(r)));
  const shared = [...A.keys()].filter((c) => B.has(c)).sort();
  if (shared.length < 2) return undefined;
  const val = (rs: Row[]): number => mean(rs.map((r) => (metric === "resolved" ? (r.resolved ? 1 : 0) : r.f2p)));
  const cmp = compareTargets(shared.map((caseId) => ({ caseId, a: val(A.get(caseId)!), b: val(B.get(caseId)!) })));
  const better = shared.filter((c) => val(A.get(c)!) > val(B.get(c)!)).length;
  const worse = shared.filter((c) => val(A.get(c)!) < val(B.get(c)!)).length;
  const p = cmp.paired;
  return { a, b, metric, cases: shared.length, meanA: mean(shared.map((c) => val(A.get(c)!))), meanB: mean(shared.map((c) => val(B.get(c)!))), diff: p.meanDiff, lo: p.lo, hi: p.hi, p: p.p, better, worse, verdict: p.p < 0.05 ? (p.meanDiff > 0 ? `${a} better` : `${b} better`) : "no measurable difference" };
}

const out: Record<string, unknown> = { targets: {}, byKind: {}, bySplit: {}, byGap: {}, perCase: {}, comparisons: [] };
const lines: string[] = [];
lines.push("| target | cases | trials | resolved | 95% CI | every trial | any trial | fail-to-pass share | tokens in / out per trial | est. $ per trial | est. $ per solve | s per trial | turns |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const t of targets) {
  const s = summary(rows.filter((r) => r.target === t));
  (out.targets as Record<string, unknown>)[t] = s;
  lines.push(`| ${t} | ${s.cases} | ${s.trials} | ${s.resolved}/${s.trials} = ${pct(s.rate)} | [${pct(s.lo)}, ${pct(s.hi)}] | ${s.allTrials}/${s.cases} | ${s.anyTrial}/${s.cases} | ${pct(s.f2p)} | ${(s.tokensIn / 1000).toFixed(0)}k / ${(s.tokensOut / 1000).toFixed(1)}k | $${s.cost.toFixed(3)} | ${s.costPerSolve === null ? "n/a" : `$${s.costPerSolve.toFixed(3)}`} | ${s.seconds.toFixed(0)} | ${s.turns.toFixed(1)} |`);
}
lines.push("", "| target | fix tasks resolved | feat tasks resolved | dev | held-out | ran tests | wrote tests | trials that tried to leave the task | errors |", "|---|---|---|---|---|---|---|---|---|");
for (const t of targets) {
  const rs = rows.filter((r) => r.target === t);
  const part = (f: (r: Row) => boolean): string => { const s = summary(rs.filter(f)); return `${s.resolved}/${s.trials} = ${pct(s.rate)}`; };
  const s = summary(rs);
  (out.byKind as Record<string, unknown>)[t] = { fix: summary(rs.filter((r) => r.kind === "fix")), feat: summary(rs.filter((r) => r.kind === "feat")) };
  (out.bySplit as Record<string, unknown>)[t] = { dev: summary(rs.filter((r) => r.split === "dev")), heldout: summary(rs.filter((r) => r.split === "heldout")) };
  lines.push(`| ${t} | ${part((r) => r.kind === "fix")} | ${part((r) => r.kind === "feat")} | ${part((r) => r.split === "dev")} | ${part((r) => r.split === "heldout")} | ${pct(s.ranTests)} | ${pct(s.wroteTests)} | ${s.leftTask} | ${s.errors} |`);
}
// Which tasks could be passed from the title-only statement at all: contracts/gaps.json lists, per task, the
// fail-to-pass tests that assert something neither that statement nor the starting tree determines.
const gapsFile = `${here}/contracts/gaps.json`;
if (fs.existsSync(gapsFile)) {
  const gaps = JSON.parse(fs.readFileSync(gapsFile, "utf8")) as Record<string, { f2pTestsBlocked: number }>;
  const blocked = (r: Row): boolean => (gaps[r.caseId]?.f2pTestsBlocked ?? 0) > 0;
  out.byGap = {};
  lines.push("", "| target | tasks the title-only statement fully determines | tasks with a test it does not determine |", "|---|---|---|");
  for (const t of targets) {
    const rs = rows.filter((r) => r.target === t);
    const a = summary(rs.filter((r) => !blocked(r)));
    const b = summary(rs.filter(blocked));
    (out.byGap as Record<string, unknown>)[t] = { determined: a, undetermined: b };
    lines.push(`| ${t} | ${a.resolved}/${a.trials} = ${pct(a.rate)} (${a.cases} tasks) | ${b.resolved}/${b.trials} = ${pct(b.rate)} (${b.cases} tasks) |`);
  }
}
lines.push("", `| task | kind | split | ${targets.join(" | ")} |`, `|---|---|---|${targets.map(() => "---").join("|")}|`);
for (const c of [...cases].sort((x, y) => (x.tags[0]! + x.id).localeCompare(y.tags[0]! + y.id))) {
  const cells = targets.map((t) => { const rs = rows.filter((r) => r.target === t && r.caseId === c.id); return rs.length ? `${rs.filter((r) => r.resolved).length}/${rs.length} (${pct(mean(rs.map((r) => r.f2p)))})` : "·"; });
  (out.perCase as Record<string, unknown>)[c.id] = Object.fromEntries(targets.map((t, i) => [t, cells[i]]));
  lines.push(`| ${c.id} | ${c.tags[0]} | ${c.tags[1]} | ${cells.join(" | ")} |`);
}
// A vs B. "plain" targets got the title-only statement, "spec" targets the statement with the written requirements.
const PAIRS = [
  ["sonnet-spec", "sonnet-plain"], // what the written requirements are worth, cheaper model
  ["opus-spec", "opus-plain"], // same, larger model
  ["opus-plain", "sonnet-plain"], // what the larger model is worth on a vague statement
  ["opus-spec", "sonnet-spec"], // what the larger model is worth on a specified statement
  ["sonnet-plain-rules", "sonnet-plain"], // what the rules are worth on a vague statement, cheaper model
  ["opus-plain-rules", "opus-plain"], // same, larger model
  ["sonnet-plain-rules", "opus-plain"], // cheaper model with rules against the larger model without
  ["sonnet-spec", "sonnet-plain-rules"], // written requirements against rules
  ["sonnet-spec", "opus-plain"], // cheaper model with a good statement against the larger model with a vague one
];
const pairs: [string, string][] = [];
for (const a of targets) for (const b of targets) if (a !== b && PAIRS.some(([x, y]) => x === a && y === b)) pairs.push([a, b]);
if (pairs.length) lines.push("", "| comparison | scope | metric | cases | A | B | difference | 95% CI | p | cases A better / worse | verdict |", "|---|---|---|---|---|---|---|---|---|---|---|");
for (const [a, b] of pairs) {
  for (const [scope, f] of [["all", () => true], ["held-out", (r: Row) => r.split === "heldout"], ["dev", (r: Row) => r.split === "dev"]] as [string, (r: Row) => boolean][]) {
    for (const metric of ["resolved", "f2p"] as const) {
      const c = paired(a, b, f, metric);
      if (!c) continue;
      (out.comparisons as unknown[]).push({ scope, ...c });
      lines.push(`| ${a} vs ${b} | ${scope} | ${metric === "resolved" ? "resolved" : "fail-to-pass share"} | ${c.cases} | ${pct(c.meanA)} | ${pct(c.meanB)} | ${c.diff >= 0 ? "+" : ""}${(c.diff * 100).toFixed(1)} pts | [${(c.lo * 100).toFixed(1)}, ${(c.hi * 100).toFixed(1)}] | ${c.p.toFixed(3)} | ${c.better} / ${c.worse} | ${c.verdict} |`);
    }
  }
}
fs.mkdirSync(outDir, { recursive: true });
// one line per trial, without the transcript: enough to redo every table here
fs.writeFileSync(`${outDir}/trials.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
fs.writeFileSync(`${outDir}/summary.json`, `${JSON.stringify(out, null, 1)}\n`);
fs.writeFileSync(`${outDir}/summary.md`, `${lines.join("\n")}\n`);
console.log(process.argv.includes("--json") ? JSON.stringify(out, null, 1) : lines.join("\n"));
