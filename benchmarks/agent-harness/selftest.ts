// Grader self-test, no agent involved: for every task the untouched workspace must be unresolved with 0 fail-to-pass
// tests passing, and the reference commit must be resolved. Run after build_tasks.py: bun selftest.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { ScoreContext } from "../../src/index.ts";
import { PRIVATE, resolved, TASKS } from "./bench.ts";

const REPO = path.resolve(import.meta.dir, "../..");
const cases = JSON.parse(fs.readFileSync(`${import.meta.dir}/cases.json`, "utf8")) as { id: string; input: string; meta: { commit: string } }[];
const ctxFor = (c: (typeof cases)[number], workspace: string): ScoreContext => ({ case: c, trial: 0, trace: { id: "t", caseId: c.id, targetId: "selftest", trial: 0, startedAt: "", endedAt: "", messages: [], spans: [], output: null, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, meta: { workspace } } }) as unknown as ScoreContext;

let bad = 0;
for (const c of cases) {
  const untouched = await resolved(ctxFor(c, `${TASKS}/${c.id}`));
  const ref = fs.mkdtempSync(path.join(PRIVATE, "scratch", "selftest-")); // a reference tree is a solution: keep it where no agent can read
  Bun.spawnSync(["bash", "-c", `git -C ${REPO} archive ${c.meta.commit} | tar -x -C ${ref}`]);
  const reference = await resolved(ctxFor(c, ref));
  fs.rmSync(ref, { recursive: true, force: true });
  const ok = untouched.pass === false && untouched.value === 0 && reference.pass === true && reference.value === 1;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${c.id.padEnd(24)} untouched: ${untouched.reason.padEnd(44)} reference: ${reference.reason}`);
}
console.log(bad ? `${bad} task(s) grade wrongly` : `grader agrees with the known answers on all ${cases.length} tasks`);
process.exit(bad ? 1 : 0);
