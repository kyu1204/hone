import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { ChatMessage, Trace, Trial } from "../../core/types";
import { forkCommand } from "./fork";
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

function project(): { dir: string; trialId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-forkcmd-"));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "hone.config.ts"),
    'export default { targets: { t: { kind: "fn", fn: (_i: unknown, ctx: { prefix?: { content: unknown }[] }) => "answer from " + String(ctx.prefix?.at(-1)?.content) } }, cases: [{ id: "c", input: "question" }], scorers: [{ name: "contains", text: "right document" }] };\n',
  );
  const store = new Store(path.join(dir, ".hone"));
  const run = store.createRun({ configHash: "h", targets: ["t"], caseIds: ["c"] });
  const messages: ChatMessage[] = [
    { role: "user", content: "question" },
    { role: "assistant", content: "", tool_calls: [{ id: "x", type: "function", function: { name: "search", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "x", name: "search", content: "wrong document" },
    { role: "assistant", content: "wrong answer" },
  ];
  const trial: Trial = { id: Store.trialId(run.id, "c", "t", 0), runId: run.id, trace: { ...base, id: "o", caseId: "c", targetId: "t", trial: 0, messages, spans: [] }, scores: [{ scorer: "contains", value: 0, pass: false }], flags: [], pass: false, costUsd: 0.1 };
  store.saveTrial(trial);
  store.finishRun(run.id, {});
  store.close();
  return { dir, trialId: trial.id };
}

describe("hone fork", () => {
  test("--step with --content re-runs from the edited prefix and reports the verdict change", async () => {
    const { dir, trialId } = project();
    const o = io(dir);
    expect(await forkCommand([trialId, "--step", "2", "--content", "right document"], o)).toBe(0);
    expect(o.out).toMatch(/FAIL -> PASS/);
    expect(o.out).toMatch(/forked trial .*t-1|trial .*-1/);
    expect(o.out).toMatch(/different-content|missing-in/);
    const store = new Store(path.join(dir, ".hone"));
    const forked = store.queryTrials({ caseId: "c" }).find((t) => t.flags.some((f) => f.startsWith("forked-from:")))!;
    store.close();
    expect(forked.pass).toBe(true);
    expect(forked.trace.messages[2]).toMatchObject({ role: "tool", name: "search", tool_call_id: "x", content: "right document" });
  });

  test("--file reads the content; --json prints the forked trial", async () => {
    const { dir, trialId } = project();
    fs.writeFileSync(path.join(dir, "edit.txt"), "right document from file\n");
    const o = io(dir);
    expect(await forkCommand([trialId, "--step", "2", "--file", "edit.txt", "--json"], o)).toBe(0);
    const j = JSON.parse(o.out);
    expect(j.forked.pass).toBe(true);
    expect(j.from).toBe(trialId);
    expect(j.forked.trace.messages[2].content).toBe("right document from file");
  });

  test("without --step prints the fork candidates; unknown trial or missing content exits 2", async () => {
    const { dir, trialId } = project();
    const o = io(dir);
    expect(await forkCommand([trialId], o)).toBe(0);
    expect(o.out).toMatch(/fork candidates: step 1/);
    expect(o.out).toMatch(/last tool call/);
    const o2 = io(dir);
    expect(await forkCommand(["nope", "--step", "1", "--content", "x"], o2)).toBe(2);
    expect(o2.err).toMatch(/not found/);
    const o3 = io(dir);
    expect(await forkCommand([trialId, "--step", "2"], o3)).toBe(2);
    expect(o3.err).toMatch(/--content or --file/);
    const o4 = io(dir);
    expect(await forkCommand([trialId, "--step", "9", "--content", "x"], o4)).toBe(2);
    expect(o4.err).toMatch(/step 9 out of range/);
  });
});
