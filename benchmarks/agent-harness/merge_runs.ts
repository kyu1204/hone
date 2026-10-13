// The stages run in batches, one hone run each. This copies their trials into a single run so hone's own commands
// (matrix, compare, cluster, explain) work on the whole study. Usage: bun merge_runs.ts [--runs runs.json] [--tag dev|heldout] [--targets a,b]
import * as fs from "node:fs";
import { Store } from "../../src/core/store";

const here = import.meta.dir;
const arg = (name: string): string | undefined => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const tag = arg("--tag");
const only = arg("--targets")?.split(",");
const runs = JSON.parse(fs.readFileSync(`${here}/${arg("--runs") ?? "runs.json"}`, "utf8")) as { target: string; cases: string[]; runId: string }[];
const cases = JSON.parse(fs.readFileSync(`${here}/cases.json`, "utf8")) as { id: string; tags: string[] }[];
const wanted = new Set(cases.filter((c) => !tag || c.tags.includes(tag)).map((c) => c.id));

const store = new Store(`${here}/.hone`);
const trials = runs.filter((r) => !only || only.includes(r.target)).flatMap((r) => store.queryTrials({ runId: r.runId })).filter((t) => wanted.has(t.trace.caseId));
const targets = [...new Set(trials.map((t) => t.trace.targetId))];
const run = store.createRun({ configHash: `merged${tag ? `-${tag}` : ""}`, targets, caseIds: [...new Set(trials.map((t) => t.trace.caseId))].sort() });
for (const t of trials) store.saveTrial({ ...t, id: Store.trialId(run.id, t.trace.caseId, t.trace.targetId, t.trace.trial), runId: run.id });
const passed = trials.filter((t) => t.pass === true).length;
store.finishRun(run.id, { merged: runs.map((r) => r.runId), tag: tag ?? "all", totals: { trials: trials.length, passed, passAt1: trials.length ? passed / trials.length : 0, costUsd: trials.reduce((a, t) => a + t.costUsd, 0) } });
store.close();
console.log(run.id);
