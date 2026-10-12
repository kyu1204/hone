import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createScorers } from "../scorers/index";
import { createTargets } from "../targets/index";
import { Cache } from "./cache";
import type { GateSpec, ScorerSpec, TargetSpec } from "./config";
import { HoneEvents } from "./events";
import { createExecutor } from "./executor";
import { Store } from "./store";
import type { Case } from "./types";

const dirs: string[] = [];
function root(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-exec-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup(opts: { targets: Record<string, TargetSpec>; scorers: ScorerSpec[]; cases: Case[]; gates?: GateSpec; useCache?: boolean }) {
  const dir = root();
  const store = new Store(dir);
  const cache = new Cache(path.join(dir, "cache"));
  const events = new HoneEvents();
  const run = store.createRun({ configHash: "h", targets: Object.keys(opts.targets), caseIds: opts.cases.map((c) => c.id) });
  const execute = createExecutor({ targets: createTargets(opts.targets), scorers: createScorers(opts.scorers), cases: opts.cases, cache, store, events, gates: opts.gates, runId: run.id, useCache: opts.useCache });
  return { execute, store, events, run };
}

describe("executor", () => {
  test("runs target and scorers, stores the trial, and serves the second identical trial from cache", async () => {
    let calls = 0;
    const { execute, store, events } = setup({
      targets: { t: { kind: "fn", fn: (input: unknown) => { calls++; return `echo ${String(input)}`; } } },
      scorers: [{ name: "exact" }, { name: "contains", text: "echo" }],
      cases: [{ id: "c1", input: "hi", expected: "echo hi" }],
    });
    const scored: string[] = [];
    events.on("score:done", (p) => scored.push(p.score.scorer));
    const first = await execute({ caseId: "c1", targetId: "t" }, 0);
    expect(first.pass).toBe(true);
    expect(first.flags).toEqual([]);
    expect(first.scores.map((s) => s.pass)).toEqual([true, true]);
    expect(scored).toEqual(["exact", "contains"]);
    const second = await execute({ caseId: "c1", targetId: "t" }, 1);
    expect(calls).toBe(1);
    expect(second.flags).toContain("cached");
    expect(second.trace.output).toBe("echo hi");
    expect(store.queryTrials({ caseId: "c1" })).toHaveLength(2);
    expect(second.id).toBe(Store.trialId(second.runId, "c1", "t", 1));
  });

  test("a target that records no messages gets a synthesized user/assistant pair so forks, diffs and rollouts work", async () => {
    const { execute } = setup({
      targets: { plain: { kind: "fn", fn: (input: unknown) => ({ answer: String(input).toUpperCase() }) }, rich: { kind: "fn", fn: (_i: unknown, ctx: { message: (m: { role: "user" | "assistant"; content: string }) => void }) => { ctx.message({ role: "user", content: "custom" }); ctx.message({ role: "assistant", content: "reply" }); return "reply"; } } },
      scorers: [],
      cases: [{ id: "c1", input: "hi" }],
    });
    const plain = await execute({ caseId: "c1", targetId: "plain" }, 0);
    expect(plain.trace.messages).toEqual([{ role: "user", content: "hi" }, { role: "assistant", content: '{"answer":"HI"}' }]);
    expect(plain.trace.meta?.synthesizedMessages).toBe(true);
    const rich = await execute({ caseId: "c1", targetId: "rich" }, 0);
    expect(rich.trace.messages.map((m) => m.content)).toEqual(["custom", "reply"]);
    expect(rich.trace.meta?.synthesizedMessages).toBeUndefined();
  });

  test("useCache: false calls the target every time", async () => {
    let calls = 0;
    const { execute } = setup({ targets: { t: { kind: "fn", fn: () => { calls++; return "x"; } } }, scorers: [], cases: [{ id: "c", input: 1 }], useCache: false });
    await execute({ caseId: "c", targetId: "t" }, 0);
    await execute({ caseId: "c", targetId: "t" }, 1);
    expect(calls).toBe(2);
  });

  test("pass logic: false beats true, null-only is null, errors fail", async () => {
    const { execute } = setup({
      targets: { t: { kind: "fn", fn: () => "out" }, boom: { kind: "fn", fn: () => { throw new Error("kaput"); } } },
      scorers: [{ name: "exact", expected: "out" }, { name: "exact", id: "wrong", expected: "nope" }],
      cases: [{ id: "c", input: 1 }],
    });
    const mixed = await execute({ caseId: "c", targetId: "t" }, 0);
    expect(mixed.pass).toBe(false);
    const errored = await execute({ caseId: "c", targetId: "boom" }, 0);
    expect(errored.pass).toBe(false);
    expect(errored.trace.error).toMatch(/kaput/);
    const { execute: noScorers } = setup({ targets: { t: { kind: "fn", fn: () => "out" } }, scorers: [], cases: [{ id: "c", input: 1 }] });
    expect((await noScorers({ caseId: "c", targetId: "t" }, 0)).pass).toBeNull();
  });

  test("reward-hack flag and gate modes", async () => {
    const diff = "diff --git a/src/app.test.ts b/src/app.test.ts\n--- a/src/app.test.ts\n+++ b/src/app.test.ts\n@@ -1 +1 @@\n-test('x', () => {\n+test.skip('x', () => {\n";
    const target = { kind: "fn", fn: () => ({ output: "done", artifacts: { diff } }) };
    const cases: Case[] = [{ id: "c", input: 1 }];
    const warn = await setup({ targets: { t: target }, scorers: [{ name: "hack" }, { name: "exact", expected: "done" }], cases }).execute({ caseId: "c", targetId: "t" }, 0);
    expect(warn.flags).toContain("reward-hack");
    expect(warn.pass).toBe(false);
    const ignore = await setup({ targets: { t: target }, scorers: [{ name: "hack" }, { name: "exact", expected: "done" }], cases, gates: { rewardHack: "ignore" } }).execute({ caseId: "c", targetId: "t" }, 0);
    expect(ignore.flags).not.toContain("reward-hack");
    const warnOnly = await setup({ targets: { t: target }, scorers: [{ name: "hack" }, { name: "exact", expected: "done" }], cases, gates: { rewardHack: "warn" } }).execute({ caseId: "c", targetId: "t" }, 0);
    expect(warnOnly.flags).toContain("reward-hack");
    expect(warnOnly.pass).toBe(true);
  });

  test("timeout flag, scorer exceptions and cost accounting", async () => {
    const { execute } = setup({
      targets: { t: { kind: "fn", fn: () => ({ output: null, error: "timeout", usage: { costUsd: 0.5 } }) } },
      scorers: [{ name: "regex", pattern: "(" }],
      cases: [{ id: "c", input: 1 }],
    });
    const trial = await execute({ caseId: "c", targetId: "t" }, 0);
    expect(trial.flags).toContain("timeout");
    expect(trial.pass).toBe(false);
    expect(trial.scores[0]?.pass).toBeNull();
    expect(trial.scores[0]?.reason).toMatch(/scorer error/);
    expect(trial.costUsd).toBeCloseTo(0.5, 12);
  });

  test("unknown case or target is a clear error", async () => {
    const { execute } = setup({ targets: { t: { kind: "fn", fn: () => 1 } }, scorers: [], cases: [{ id: "c", input: 1 }] });
    await expect(execute({ caseId: "zzz", targetId: "t" }, 0)).rejects.toThrow(/case "zzz"/);
    await expect(execute({ caseId: "c", targetId: "zzz" }, 0)).rejects.toThrow(/target "zzz"/);
  });
});
