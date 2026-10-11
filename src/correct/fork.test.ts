import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../test/fixtures/trace.valid.json";
import { Store } from "../core/store";
import type { ChatMessage, Trace, Trial } from "../core/types";
import { createTargets } from "../targets/index";
import type { FnContext } from "../targets/fn";
import { forkTrial, loadForkDeps } from "./fork";

const base = valid as Trace;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("forkTrial", () => {
  test("re-runs the target from an edited prefix and stores a flagged trial", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-fork-"));
    dirs.push(root);
    const store = new Store(root);
    const run = store.createRun({ configHash: "h", targets: ["t"], caseIds: ["c"] });
    const messages: ChatMessage[] = [{ role: "user", content: "question" }, { role: "tool", tool_call_id: "x", name: "search", content: "wrong document" }, { role: "assistant", content: "wrong answer" }];
    const original: Trial = { id: Store.trialId(run.id, "c", "t", 0), runId: run.id, trace: { ...base, id: "o", caseId: "c", targetId: "t", trial: 0, messages }, scores: [{ scorer: "exact", value: 0, pass: false }], flags: [], pass: false, costUsd: 0.1 };
    store.saveTrial(original);
    const targets = createTargets({ t: { kind: "fn", fn: (_i: unknown, ctx: FnContext) => `answer from ${String(ctx.prefix?.at(-1)?.content)}` } });
    const seen: string[] = [];
    const forked = await forkTrial({
      store,
      targets,
      scorers: [{ name: "contains", text: "right document" }],
      caseInput: "question",
      original,
      step: 1,
      edited: { ...messages[1]!, content: "right document" },
      log: (l) => seen.push(l),
    });
    expect(forked.flags).toContain(`forked-from:${original.id}`);
    expect(forked.trace.meta?.forkStep).toBe(1);
    expect(forked.trace.output).toBe("answer from right document");
    expect(forked.trace.messages[0]).toEqual(messages[0]);
    expect(forked.trace.messages[1]?.content).toBe("right document");
    expect(forked.pass).toBe(true);
    expect(store.getTrial(forked.id)).toBeDefined();
    expect(forked.trace.trial).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
  });

  test("a target without resume still runs with ctx.prefix", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hone-fork2-"));
    dirs.push(root);
    const store = new Store(root);
    const run = store.createRun({ configHash: "h", targets: ["m"], caseIds: ["c"] });
    const original: Trial = { id: Store.trialId(run.id, "c", "m", 0), runId: run.id, trace: { ...base, id: "o", caseId: "c", targetId: "m", trial: 0, messages: [{ role: "user", content: "q" }] }, scores: [], flags: [], pass: null, costUsd: 0 };
    const targets = createTargets({ m: { kind: "replay", traces: [{ ...base, id: "r", caseId: "c", targetId: "m", trial: 0, output: "replayed" }] } });
    const forked = await forkTrial({ store, targets, scorers: [], caseInput: "q", original, step: 0, edited: { role: "user", content: "edited q" } });
    expect(forked.trace.output).toBe("replayed");
    expect(forked.flags).toContain(`forked-from:${original.id}`);
  });

  test("loadForkDeps builds targets, scorer specs and case inputs from the config", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-forkdeps-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "hone.config.ts"), 'export default { targets: { t: { kind: "fn", fn: () => "x" } }, cases: [{ id: "c", input: "question" }], scorers: [{ name: "exact" }] };\n');
    const deps = await loadForkDeps(dir);
    expect(Object.keys(deps.targets)).toEqual(["t"]);
    expect(deps.scorers).toEqual([{ name: "exact" }]);
    expect(deps.caseInputs).toEqual({ c: "question" });
  });
});
