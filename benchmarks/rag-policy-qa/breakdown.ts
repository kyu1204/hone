// Per-group usefulness/safety for a run, in the project's own terms: 2 = useful, 1 = safe, 0 = hallucination.
import { Store } from "../../src/core/store";
const runId = process.argv[2];
const store = new Store(`${import.meta.dir}/.hone`);
const run = runId ? store.getRun(runId) : store.listRuns(1)[0];
const trials = store.queryTrials({ runId: run!.id });
const groupOf = (t: string): string => (t === "quant" ? "정량" : t === "qual" ? "정성" : "답 없음·함정");
const groups = new Map<string, number[]>();
const causes = new Map<string, number>();
for (const t of trials) {
  const g = groupOf(((t.trace as unknown as { caseId: string }).caseId.startsWith("quant") ? "quant" : t.trace.caseId.startsWith("qual") ? "qual" : "neg"));
  const s = t.scores.find((x) => x.scorer === "grade");
  const v = s ? Math.round(s.value * 2) : -1;
  (groups.get(g) ?? groups.set(g, []).get(g)!).push(v);
  (groups.get("전체") ?? groups.set("전체", []).get("전체")!).push(v);
  if (v < 2 && s?.reason) { const c = s.reason.split(" (")[0]!; causes.set(c, (causes.get(c) ?? 0) + 1); }
}
console.log(`run ${run!.id} (${trials.length} trials)`);
console.log("group            n   useful(2)  safe(>0)   dist 2/1/0");
for (const [g, vs] of groups) console.log(`${g.padEnd(14)} ${String(vs.length).padStart(4)}   ${((vs.filter((v) => v === 2).length / vs.length) * 100).toFixed(1).padStart(6)}%   ${((vs.filter((v) => v > 0).length / vs.length) * 100).toFixed(1).padStart(6)}%   ${vs.filter((v) => v === 2).length}/${vs.filter((v) => v === 1).length}/${vs.filter((v) => v === 0).length}`);
console.log("causes:", [...causes.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(", "));
store.close();
