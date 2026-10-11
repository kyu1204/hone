import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { Trace, Trial, TrialFlag } from "../../core/types";
import { matrixCommand } from "./matrix";
import type { CommandIo } from "./run";

const base = valid as Trace;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function io(cwd: string): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd, env: {}, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-matrix-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "hone.config.ts"), "export default { targets: {}, cases: [], scorers: [] };\n");
  const store = new Store(path.join(dir, ".hone"));
  const run = store.createRun({ configHash: "h", targets: ["cc-opus", "cc-sonnet", "codex"], caseIds: [] });
  const spec: Record<string, { model: string; agent: string; pass: (c: number) => boolean; cost: number; tokens: number; flags?: TrialFlag[] }> = {
    "cc-opus": { model: "opus", agent: "claude-code", pass: () => true, cost: 0.2, tokens: 50_000 },
    "cc-sonnet": { model: "sonnet", agent: "claude-code", pass: (c) => c % 2 === 0, cost: 0.05, tokens: 20_000 },
    codex: { model: "gpt", agent: "codex", pass: (c) => c % 5 === 0, cost: 0.1, tokens: 30_000, flags: ["timeout"] },
  };
  for (const [targetId, s] of Object.entries(spec)) {
    for (let c = 0; c < 10; c++) {
      for (let t = 0; t < 3; t++) {
        const pass = s.pass(c);
        const trace: Trace = { ...base, id: `${targetId}-${c}-${t}`, caseId: `case${c}`, targetId, trial: t, startedAt: "2026-10-12T00:00:00.000Z", endedAt: "2026-10-12T00:00:02.000Z", usage: { inputTokens: s.tokens, outputTokens: 0, costUsd: s.cost }, meta: { model: s.model, agent: s.agent } };
        const trial: Trial = { id: Store.trialId(run.id, `case${c}`, targetId, t), runId: run.id, trace, scores: [], flags: c === 0 && s.flags ? s.flags : [], pass, costUsd: s.cost };
        store.saveTrial(trial);
      }
    }
  }
  store.finishRun(run.id, {});
  store.close();
  return dir;
}

describe("hone matrix", () => {
  test("per-target aggregates sorted by pass rate, with bands", async () => {
    const dir = project();
    const o = io(dir);
    expect(await matrixCommand([], o)).toBe(0);
    const lines = o.out.split("\n").filter((l) => /cc-opus|cc-sonnet|codex/.test(l));
    expect(lines[0]).toContain("cc-opus");
    expect(lines[1]).toContain("cc-sonnet");
    expect(lines[2]).toContain("codex");
    expect(o.out).toMatch(/\$\/solve/);
    expect(o.out).toMatch(/tokens\/solve/);
    expect(o.out).toMatch(/band/i);
  });

  test("--json exposes the numbers and --by model groups targets", async () => {
    const dir = project();
    const o = io(dir);
    await matrixCommand(["--json"], o);
    const doc = JSON.parse(o.out) as { rows: { id: string; passAt1: number; costPerSolve: number | null; tokensPerSolve: number | null; timeouts: number; trials: number; band: string }[] };
    const opus = doc.rows.find((r) => r.id === "cc-opus")!;
    expect(opus.passAt1).toBe(1);
    expect(opus.costPerSolve).toBeCloseTo(0.2, 9);
    expect(opus.tokensPerSolve).toBe(50_000);
    expect(doc.rows.find((r) => r.id === "codex")!.timeouts).toBe(3);
    expect(opus.band).toMatch(/^[A-Z]$/);
    const g = io(dir);
    await matrixCommand(["--json", "--by", "agent"], g);
    const grouped = JSON.parse(g.out) as { rows: { id: string; trials: number }[] };
    expect(grouped.rows.map((r) => r.id).sort()).toEqual(["claude-code", "codex"]);
    expect(grouped.rows.find((r) => r.id === "claude-code")!.trials).toBe(60);
  });

  test("no runs is a clear message", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-matrix-empty-"));
    dirs.push(dir);
    const o = io(dir);
    expect(await matrixCommand([], o)).toBe(2);
    expect(o.err).toMatch(/no runs/);
  });
});
