// Per-group usefulness/safety for one target of the latest run in ./confirm/.hone (0/1/2 terms).
import { Store } from "../../src/core/store";
const target = process.argv[2]!;
const store = new Store(`${process.cwd()}/.hone`);
const run = store.listRuns(1)[0]!;
const trials = store.queryTrials({ runId: run.id, targetId: target });
store.close();
if (!trials.length) { console.log(`${target}: no trials`); process.exit(0); }
const groups = new Map<string, number[]>();
for (const t of trials) {
  const g = t.trace.caseId.startsWith("quant") ? "정량" : t.trace.caseId.startsWith("qual") ? "정성" : "답 없음·함정";
  const v = Math.round((t.scores.find((s) => s.scorer === "grade")?.value ?? -0.5) * 2);
  for (const k of [g, "전체"]) (groups.get(k) ?? groups.set(k, []).get(k)!).push(v);
}
for (const [g, vs] of groups) console.log(`${target.padEnd(8)} ${g.padEnd(10)} n=${String(vs.length).padStart(3)}  useful ${((vs.filter((v) => v === 2).length / vs.length) * 100).toFixed(1).padStart(5)}%  safe ${((vs.filter((v) => v > 0).length / vs.length) * 100).toFixed(1).padStart(5)}%  2/1/0 ${vs.filter((v) => v === 2).length}/${vs.filter((v) => v === 1).length}/${vs.filter((v) => v === 0).length}`);
