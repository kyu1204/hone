import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import valid from "../../test/fixtures/trace.valid.json";
import type { Trace } from "../core/types";
import { createTarget } from "./index";
import type { RunContext } from "./target";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-replay-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function trace(caseId: string, trial: number, output: string): Trace {
  return { ...(valid as Trace), id: `${caseId}-${trial}`, caseId, trial, output };
}
const ctx = (caseId: string, trial: number): RunContext => ({ runId: "r", caseId, trial });

describe("replay target", () => {
  test("inline traces: selects by case and trial, falls back modulo count", async () => {
    const t = createTarget("rp", { kind: "replay", traces: [trace("a", 0, "a0"), trace("a", 1, "a1"), trace("b", 0, "b0")] });
    expect((await t.run("x", ctx("a", 1))).output).toBe("a1");
    expect((await t.run("x", ctx("a", 5))).output).toBe("a1");
    const b = await t.run("x", ctx("b", 0));
    expect(b.output).toBe("b0");
    expect(b.messages).toHaveLength(5);
    expect(b.usage).toEqual((valid as Trace).usage);
    expect(b.meta?.replayedFrom).toBe("b-0");
  });

  test("missing case is an error", async () => {
    const t = createTarget("rp", { kind: "replay", traces: [trace("a", 0, "a0")] });
    expect((await t.run("x", ctx("zzz", 0))).error).toMatch(/no replay trace for case zzz/);
  });

  test("globs load json (single and array) and jsonl, validating each trace", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "one.json"), JSON.stringify(trace("a", 0, "a0")));
    fs.writeFileSync(path.join(d, "many.json"), JSON.stringify([trace("a", 1, "a1"), trace("b", 0, "b0")]));
    fs.writeFileSync(path.join(d, "lines.jsonl"), `${JSON.stringify(trace("c", 0, "c0"))}\n`);
    const t = createTarget("rp", { kind: "replay", traces: [path.join(d, "*.json"), path.join(d, "*.jsonl")] });
    expect((await t.run("x", ctx("a", 1))).output).toBe("a1");
    expect((await t.run("x", ctx("c", 0))).output).toBe("c0");
    const v1 = await t.version();
    fs.writeFileSync(path.join(d, "bad.json"), JSON.stringify({ not: "a trace" }));
    const bad = createTarget("rp", { kind: "replay", traces: path.join(d, "*.json") });
    expect((await bad.run("x", ctx("a", 0))).error).toMatch(/bad\.json/);
    expect(await bad.version()).not.toBe(v1);
  });

  test("random selection stays within the case", async () => {
    const t = createTarget("rp", { kind: "replay", traces: [trace("a", 0, "a0"), trace("a", 1, "a1")], select: "random" });
    for (let i = 0; i < 5; i++) expect(["a0", "a1"]).toContain((await t.run("x", ctx("a", 9))).output as string);
  });
});
