import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { Trace, Trial } from "../../core/types";
import { explainCommand } from "./explain";
import { reportCommand } from "./report";
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

function project(): { dir: string; trialId: string; runId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-explain-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "hone.config.ts"), "export default { targets: {}, cases: [], scorers: [] };\n");
  const store = new Store(path.join(dir, ".hone"));
  const run = store.createRun({ configHash: "h", targets: ["rag"], caseIds: ["citations-basic", "other"] });
  const trial: Trial = {
    id: Store.trialId(run.id, "citations-basic", "rag", 0),
    runId: run.id,
    trace: { ...base, meta: { model: "stub" } },
    scores: [
      { scorer: "exact", value: 1, pass: true, reason: "output equals expected" },
      { scorer: "rag.citations", value: 0.5, pass: false, reason: "1/2 citations resolve", evidence: [{ unresolved: ["c9"] }] },
    ],
    flags: ["reward-hack"],
    pass: false,
    costUsd: 0.0123,
  };
  store.saveTrial(trial);
  const other: Trial = { id: Store.trialId(run.id, "other", "rag", 0), runId: run.id, trace: { ...base, id: "o", caseId: "other" }, scores: [{ scorer: "exact", value: 1, pass: true }], flags: [], pass: true, costUsd: 0.001 };
  store.saveTrial(other);
  store.finishRun(run.id, { totals: { passAt1: 0.5 } });
  store.close();
  return { dir, trialId: trial.id, runId: run.id };
}

describe("hone explain", () => {
  test("prints header, scores with reasons and evidence, messages and spans", async () => {
    const { dir, trialId } = project();
    const o = io(dir);
    expect(await explainCommand([trialId], o)).toBe(0);
    expect(o.out).toMatch(/citations-basic/);
    expect(o.out).toMatch(/rag/);
    expect(o.out).toMatch(/FAIL|fail/);
    expect(o.out).toMatch(/reward-hack/);
    expect(o.out).toMatch(/\$0\.0123/);
    expect(o.out).toMatch(/rag\.citations.*1\/2 citations resolve/);
    expect(o.out).toMatch(/c9/);
    expect(o.out).toMatch(/tool_calls|search\(/);
    expect(o.out).toMatch(/retrieval/);
    const j = io(dir);
    await explainCommand([trialId, "--json"], j);
    expect(JSON.parse(j.out)).toMatchObject({ id: trialId, pass: false });
  });

  test("unknown trial id is an error", async () => {
    const { dir } = project();
    const o = io(dir);
    expect(await explainCommand(["nope"], o)).toBe(2);
    expect(o.err).toMatch(/nope/);
  });
});

describe("hone report", () => {
  test("writes a self-contained HTML file mentioning every case, score and flag", async () => {
    const { dir, runId } = project();
    const o = io(dir);
    expect(await reportCommand(["--out", "report.html"], o)).toBe(0);
    const html = fs.readFileSync(path.join(dir, "report.html"), "utf8");
    expect(html).toContain(runId);
    expect(html).toContain("citations-basic");
    expect(html).toContain("other");
    expect(html).toContain("rag.citations");
    expect(html).toContain("reward-hack");
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href="https?:\/\/[^"]*\.(css|js)"/);
    expect(html).toMatch(/<style>/);
    expect(o.out).toMatch(/report\.html/);
  });
});
