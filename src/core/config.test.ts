import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigNotFound, defineConfig, loadCases, loadConfig } from "./config";

const configModule = new URL("./config.ts", import.meta.url).pathname;
const dirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-config-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("defineConfig / loadConfig", () => {
  test("loads hone.config.ts and returns a stable hash", async () => {
    const d = tmp();
    fs.writeFileSync(
      path.join(d, "hone.config.ts"),
      `import { defineConfig } from ${JSON.stringify(configModule)};
export default defineConfig({ targets: { rag: { kind: "http", url: "http://localhost" } }, cases: [], scorers: [{ name: "exact" }], trials: 3 });`,
    );
    const a = await loadConfig(d);
    const b = await loadConfig(d);
    expect(a.path).toBe(path.join(d, "hone.config.ts"));
    expect(a.config.trials).toBe(3);
    expect(a.config.targets.rag?.kind).toBe("http");
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(b.hash);
  });

  test("defineConfig is the identity", () => {
    const c = { targets: {}, cases: [], scorers: [] };
    expect(defineConfig(c)).toBe(c);
  });

  test("missing config throws ConfigNotFound with an init hint", async () => {
    const d = tmp();
    const err = await loadConfig(d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigNotFound);
    expect((err as Error).message).toContain("hone init");
  });
});

describe("loadCases", () => {
  test("inline array is returned as is", async () => {
    const cases = [{ id: "a", input: 1 }];
    expect(await loadCases(cases, process.cwd())).toBe(cases);
  });

  test("yaml single case gets the file stem as id", async () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, "evals"));
    fs.writeFileSync(path.join(d, "evals", "citations-basic.yaml"), "input: When does it start?\nexpected: 2026-07-01\n");
    const cases = await loadCases("evals/*.yaml", d);
    expect(cases).toEqual([{ id: "citations-basic", input: "When does it start?", expected: "2026-07-01" }]);
  });

  test("json array gets stem#index ids, jsonl one case per line, globs may be a list", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "multi.json"), JSON.stringify([{ input: "a" }, { id: "named", input: "b" }]));
    fs.writeFileSync(path.join(d, "lines.jsonl"), '{"id":"l1","input":"x"}\n\n{"id":"l2","input":"y"}\n');
    const cases = await loadCases(["*.json", "*.jsonl"], d);
    expect(cases.map((c) => c.id).sort()).toEqual(["l1", "l2", "multi#0", "named"]);
  });

  test("duplicate ids throw", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "a.json"), JSON.stringify({ id: "dup", input: 1 }));
    fs.writeFileSync(path.join(d, "b.json"), JSON.stringify({ id: "dup", input: 2 }));
    await expect(loadCases("*.json", d)).rejects.toThrow(/duplicate case id "dup"/);
  });

  test("invalid case reports the file and the failing path", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "bad.yaml"), "input: x\ntags: [1]\n");
    await expect(loadCases("*.yaml", d)).rejects.toThrow(/bad\.yaml.*case\.tags\[0\]/);
  });

  test("no matching files throws", async () => {
    const d = tmp();
    await expect(loadCases("nothing/*.yaml", d)).rejects.toThrow(/no case files matched/);
  });
});
