import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../../test/fixtures/trace.valid.json";
import { Store } from "../../core/store";
import type { ChatMessage, Trace, Trial } from "../../core/types";
import { diffCommand } from "./diff";
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
const t = (name: string, c = "ok"): ChatMessage => ({ role: "tool", name, tool_call_id: "x", content: c });

function project(): { dir: string; ids: [string, string] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-diff-"));
  dirs.push(dir);
  const store = new Store(path.join(dir, ".hone"));
  const run = store.createRun({ configHash: "h", targets: ["x", "y"], caseIds: ["c"] });
  const mk = (target: string, messages: ChatMessage[], pass: boolean): Trial => ({ id: Store.trialId(run.id, "c", target, 0), runId: run.id, trace: { ...base, id: target, targetId: target, messages }, scores: [], flags: [], pass, costUsd: 0.01 });
  const ta = mk("x", [{ role: "user", content: "fix it" }, a("", ["Read"]), t("Read"), a("", ["Bash"]), t("Bash", "tests pass"), a("Fixed and verified.")], true);
  const tb = mk("y", [{ role: "user", content: "fix it" }, a("", ["Read"]), t("Read"), a("Fixed.")], false);
  store.saveTrial(ta);
  store.saveTrial(tb);
  store.finishRun(run.id, {});
  store.close();
  return { dir, ids: [ta.id, tb.id] };
}

describe("hone diff", () => {
  test("prints aligned rows with gap markers and the divergence summary", async () => {
    const { dir, ids } = project();
    const o = io(dir);
    expect(await diffCommand([ids[0], ids[1]], o)).toBe(0);
    expect(o.out).toMatch(/diverges at step 3/);
    expect(o.out).toMatch(/assistant → Bash\(\{\}\)\s+│\s+·/);
    expect(o.out).toMatch(/missing-in-b/);
    expect(o.out).toMatch(/Fixed and verified/);
  });

  test("--json emits the report; unknown trial exits 2", async () => {
    const { dir, ids } = project();
    const o = io(dir);
    expect(await diffCommand([ids[0], ids[1], "--json"], o)).toBe(0);
    const j = JSON.parse(o.out);
    expect(j.divergence).toBe(3);
    expect(j.rows.filter((r: { kind: string }) => r.kind === "missing-in-b")).toHaveLength(2);
    const o2 = io(dir);
    expect(await diffCommand([ids[0], "nope"], o2)).toBe(2);
    expect(o2.err).toMatch(/not found/);
  });
});
