import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { ChatMessage, Trace, Trial } from "../../core/types";
import { calibrateCommand, parseLabels } from "./calibrate";
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
const a = (c: string, tools: string[] = []): ChatMessage => ({ role: "assistant", content: c, ...(tools.length ? { tool_calls: tools.map((t, i) => ({ id: `${t}${i}`, type: "function" as const, function: { name: t, arguments: "{}" } })) } : {}) });
const t = (id: string, name: string, c = "ok"): ChatMessage => ({ role: "tool", name, tool_call_id: id, content: c });

function project(): { dir: string; runId: string; ids: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-calib-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "hone.config.ts"), 'export default { targets: {}, cases: [], scorers: [{ name: "contains", id: "says-verified", text: "verified" }, { name: "tool_used", tool: "Bash" }, { name: "exact" }], cases: [{ id: "a", input: "fix", expected: "Fixed and verified." }, { id: "b", input: "fix", expected: "Fixed and verified." }, { id: "c", input: "fix", expected: "Fixed and verified." }] };\n');
  const store = new Store(path.join(dir, ".hone"));
  const run = store.createRun({ configHash: "h", targets: ["agent"], caseIds: [] });
  const ids: string[] = [];
  for (const c of ["a", "b", "c"]) {
    const trial: Trial = { id: Store.trialId(run.id, c, "agent", 0), runId: run.id, trace: { ...base, id: c, caseId: c, output: "Fixed and verified.", spans: [], messages: [{ role: "user", content: "fix" }, a("Implemented, done.", ["Edit"]), t("Edit0", "Edit"), a("", ["Bash"]), t("Bash0", "Bash", `${c} passed`), a("Fixed and verified.")] }, scores: [], flags: [], pass: true, costUsd: 0 };
    store.saveTrial(trial);
    ids.push(trial.id);
  }
  store.finishRun(run.id, {});
  store.close();
  return { dir, runId: run.id, ids };
}

describe("parseLabels", () => {
  test("csv with trialId,label; accepts true/false, pass/fail, 1/0, header optional", () => {
    expect([...parseLabels("trialId,label\nx,true\ny,fail\nz,1\n")]).toEqual([["x", true], ["y", false], ["z", true]]);
  });
});

describe("hone calibrate", () => {
  test("writes calibration-<scorer>.json and prints the table", async () => {
    const { dir } = project();
    const o = io(dir);
    expect(await calibrateCommand(["--scorer", "says-verified", "--n", "3"], o)).toBe(0);
    const file = JSON.parse(fs.readFileSync(path.join(dir, ".hone", "analysis", "calibration-says-verified.json"), "utf8"));
    expect(file).toMatchObject({ schemaVersion: 1, judge: "says-verified", domain: "agent", falseAlarms: { n: 3, flagged: 0, rate: 0 } });
    const by = Object.fromEntries(file.faults.map((f: { type: string }) => [f.type, f]));
    expect(by["premature-done"]).toMatchObject({ injected: 3, detected: 3 });
    expect(by["verification-removed"]).toMatchObject({ injected: 3, detected: 0 });
    expect(o.out).toMatch(/premature-done\s+3\/3/);
    expect(o.out).toMatch(/false alarms 0\/3/);
    expect(o.out).toMatch(/calibration-says-verified\.json/);
  });

  test("--labels adds kappa; --json prints the file; unknown scorer exits 2", async () => {
    const { dir, ids } = project();
    fs.writeFileSync(path.join(dir, "labels.csv"), `${ids[0]},true\n${ids[1]},true\n${ids[2]},true\n`);
    const o = io(dir);
    expect(await calibrateCommand(["--scorer", "tool_used", "--labels", "labels.csv", "--json"], o)).toBe(0);
    const file = JSON.parse(o.out);
    expect(file.judge).toBe("tool_used");
    expect(file.kappa).toBe(1);
    const o2 = io(dir);
    expect(await calibrateCommand(["--scorer", "nope"], o2)).toBe(2);
    expect(o2.err).toMatch(/scorer nope not found.*says-verified/);
  });

  test("scorers that need case.expected get it from the config's cases", async () => {
    const { dir } = project();
    const o = io(dir);
    expect(await calibrateCommand(["--scorer", "exact", "--n", "3", "--json"], o)).toBe(0);
    const file = JSON.parse(o.out) as { falseAlarms: { flagged: number }; faults: { type: string; detected: number; injected: number }[] };
    expect(file.falseAlarms.flagged).toBe(0);
    expect(file.faults.find((f) => f.type === "premature-done")).toMatchObject({ injected: 3, detected: 3 });
  });
});
