import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { change, loadChanges } from "./change";

const mod = new URL("./change.ts", import.meta.url).pathname; // what a project imports as "hone-eval"
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A project whose files call change(); each body is wrapped with the import. */
function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-change-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), `import { change } from ${JSON.stringify(mod)};\n${body}\n`);
  }
  return dir;
}

describe("change files", () => {
  test("every change() in sharpen/ is loaded with the file it came from, in path order", async () => {
    const dir = project({
      "sharpen/b.ts": 'change("second", { why: "w2", text: "T" });',
      "sharpen/a.ts": 'change("first", { why: "w1", config: (c) => ({ ...c, trials: 7 }) });\nchange("both", { why: "w3", text: "U", config: (c) => c });',
      "sharpen/nested/c.mjs": 'change("third", { why: "w4", text: "V" });',
      "sharpen/a.test.ts": 'change("not a change file", { why: "x", text: "x" });',
      "elsewhere/d.ts": 'change("outside the directory", { why: "x", text: "x" });',
    });
    const changes = await loadChanges(dir);
    expect(changes.map((c) => [c.name, c.file])).toEqual([
      ["first", "sharpen/a.ts"],
      ["both", "sharpen/a.ts"],
      ["second", "sharpen/b.ts"],
      ["third", "sharpen/nested/c.mjs"],
    ]);
    expect(changes[0]!.config!({ targets: {}, cases: [], scorers: [], trials: 1 }).trials).toBe(7);
    expect(changes[1]).toMatchObject({ why: "w3", text: "U" });
    expect(changes[2]).toMatchObject({ why: "w2", text: "T" });
    expect(changes[2]!.config).toBeUndefined();
    // loading again does not pile up, and an edited file is read again
    fs.writeFileSync(path.join(dir, "sharpen/b.ts"), `import { change } from ${JSON.stringify(mod)};\nchange("second", { why: "w2", text: "edited" });\n`);
    const again = await loadChanges(dir);
    expect(again).toHaveLength(4);
    expect(again[2]!.text).toBe("edited");
  });

  test("no directory means no changes; another place can be named", async () => {
    const dir = project({ "ideas/x.ts": 'change("from ideas", { why: "w", text: "T" });' });
    expect(await loadChanges(dir)).toEqual([]);
    expect((await loadChanges(dir, "ideas/*.ts")).map((c) => c.name)).toEqual(["from ideas"]);
    expect((await loadChanges(dir, ["nothing/*.ts", "ideas/*.ts"])).map((c) => c.file)).toEqual(["ideas/x.ts"]);
  });

  test("a mistake in a change file is reported with the file", async () => {
    const bad = async (body: string): Promise<string> => {
      try {
        await loadChanges(project({ "sharpen/x.ts": body }));
        return "no error";
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(await bad('change("no reason", { text: "T" });')).toMatch(/^sharpen\/x\.ts: change "no reason": `why` says what is wrong and why this fixes it; it is required/);
    expect(await bad('change("empty", { why: "w" });')).toMatch(/^sharpen\/x\.ts: change "empty": give it a `text`, a `config` function, or both/);
    expect(await bad('change("", { why: "w", text: "T" });')).toMatch(/^sharpen\/x\.ts: a change needs a name/);
    expect(await bad('change("wrong type", { why: "w", config: "top_k 30" });')).toMatch(/^sharpen\/x\.ts: change "wrong type": `config` is a function from a config to a config/);
    expect(await bad('throw new Error("boom");')).toMatch(/^sharpen\/x\.ts: boom/);
    const twice = project({ "sharpen/a.ts": 'change("same", { why: "w", text: "T" });', "sharpen/b.ts": 'change("same", { why: "w", text: "U" });' });
    await expect(loadChanges(twice)).rejects.toThrow('two changes are named "same": sharpen/a.ts and sharpen/b.ts');
  });

  test("change() outside a load does nothing harmful", () => {
    expect(() => change("stray", { why: "w", text: "T" })).not.toThrow();
  });
});
