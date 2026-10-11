import { describe, expect, test } from "bun:test";
import valid from "../../test/fixtures/trace.valid.json";
import { HoneEvents } from "./events";
import type { Plan } from "./plan";
import { runPlan } from "./scheduler";
import type { Trace, Trial } from "./types";

const base = valid as Trace;
const cells = [
  { caseId: "a", targetId: "t" },
  { caseId: "b", targetId: "t" },
  { caseId: "c", targetId: "t" },
];

function fakeExecute(opts: { outcome: (caseId: string, trial: number, attempt: number) => { pass: boolean | null; error?: string }; delayMs?: number; onStart?: (caseId: string, trial: number) => void; onEnd?: () => void }) {
  const attempts = new Map<string, number>();
  return async (cell: { caseId: string; targetId: string }, trial: number): Promise<Trial> => {
    const key = `${cell.caseId}:${trial}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    opts.onStart?.(cell.caseId, trial);
    if (opts.delayMs) await Bun.sleep(opts.delayMs);
    const o = opts.outcome(cell.caseId, trial, attempt);
    opts.onEnd?.();
    const trace: Trace = { ...base, id: key, caseId: cell.caseId, targetId: cell.targetId, trial, usage: { inputTokens: 10, outputTokens: 1, costUsd: 0.01 }, ...(o.error ? { error: o.error } : {}) };
    return { id: key, runId: "r", trace, scores: [], flags: o.error === "timeout" ? ["timeout"] : [], pass: o.pass, costUsd: 0.01 };
  };
}

describe("runPlan fixed mode", () => {
  test("runs cells x trials round-robin within the concurrency limit and summarises", async () => {
    let inFlight = 0;
    let peak = 0;
    const order: string[] = [];
    const plan: Plan = { cells, trials: 2, concurrency: 2 };
    const events = new HoneEvents();
    const seen: string[] = [];
    events.on("run:start", () => seen.push("run:start"));
    events.on("trial:done", () => seen.push("trial:done"));
    events.on("stat:update", (p) => seen.push(`stat:${p.caseId}:${p.verdict.n}`));
    events.on("run:done", () => seen.push("run:done"));
    const execute = fakeExecute({
      outcome: (c) => ({ pass: c !== "c" }),
      delayMs: 5,
      onStart: (c, t) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        order.push(`${c}${t}`);
      },
      onEnd: () => inFlight--,
    });
    const summary = await runPlan(plan, { runId: "r", execute, events });
    expect(peak).toBe(2);
    expect(order.slice(0, 3)).toEqual(["a0", "b0", "c0"]);
    expect(summary.totals.trials).toBe(6);
    expect(summary.totals.passed).toBe(4);
    expect(summary.totals.passAt1).toBeCloseTo(4 / 6, 12);
    expect(summary.totals.costUsd).toBeCloseTo(0.06, 12);
    expect(summary.cells.find((v) => v.caseId === "c")?.passAt1).toBe(0);
    expect(seen[0]).toBe("run:start");
    expect(seen.at(-1)).toBe("run:done");
    expect(seen.filter((s) => s === "trial:done")).toHaveLength(6);
    expect(seen).toContain("stat:a:2");
    expect(summary.aborted).toBe(false);
  });

  test("retries transient errors once and records attempts", async () => {
    const execute = fakeExecute({ outcome: (c, _t, attempt) => (c === "a" && attempt === 1 ? { pass: null, error: "timeout" } : { pass: true }) });
    const summary = await runPlan({ cells: cells.slice(0, 1), trials: 1, concurrency: 1 }, { runId: "r", execute, events: new HoneEvents(), retries: 1 });
    expect(summary.totals.passed).toBe(1);
    expect(summary.totals.flagged.timeout ?? 0).toBe(0);
    const noRetry = await runPlan({ cells: cells.slice(0, 1), trials: 1, concurrency: 1 }, { runId: "r", execute: fakeExecute({ outcome: () => ({ pass: null, error: "timeout" }) }), events: new HoneEvents(), retries: 0 });
    expect(noRetry.totals.flagged.timeout).toBe(1);
  });

  test("abort stops scheduling new jobs", async () => {
    const ctrl = new AbortController();
    let started = 0;
    const execute = fakeExecute({ outcome: () => ({ pass: true }), delayMs: 20, onStart: () => started++ });
    const p = runPlan({ cells, trials: 3, concurrency: 1 }, { runId: "r", execute, events: new HoneEvents(), signal: ctrl.signal });
    await Bun.sleep(30);
    ctrl.abort();
    const summary = await p;
    expect(summary.aborted).toBe(true);
    expect(started).toBeLessThan(9);
    expect(summary.totals.trials).toBe(started);
  });
});

describe("runPlan adaptive mode", () => {
  test("a sure cell stops early, a coin-flip cell runs to maxTrials", async () => {
    let flips = 0;
    const execute = fakeExecute({ outcome: (c) => ({ pass: c === "a" ? true : flips++ % 2 === 0 }) });
    const events = new HoneEvents();
    const stopped: string[] = [];
    events.on("case:stopped", (p) => stopped.push(`${p.caseId}:${p.reason}`));
    const summary = await runPlan({ cells: cells.slice(0, 2), trials: 3, concurrency: 1, adaptive: { ciWidth: 0.45, maxTrials: 12 } }, { runId: "r", execute, events });
    const a = summary.cells.find((v) => v.caseId === "a")!;
    const b = summary.cells.find((v) => v.caseId === "b")!;
    expect(a.n).toBeLessThan(12);
    expect(b.n).toBe(12);
    expect(stopped).toContain("a:ci-width");
    expect(stopped).toContain("b:max-trials");
    expect(summary.stoppedEarly).toBe(1);
  });
});
