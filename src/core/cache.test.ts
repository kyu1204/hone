import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Cache, cacheKey, canonicalJson } from "./cache";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hone-cache-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("canonicalJson / cacheKey", () => {
  test("object key order does not matter, array order does", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(cacheKey({ b: 1, a: 2 })).toBe(cacheKey({ a: 2, b: 1 }));
    expect(cacheKey([1, 2])).not.toBe(cacheKey([2, 1]));
    expect(cacheKey("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Cache", () => {
  test("memo calls the producer once per key", async () => {
    const c = new Cache(tmp());
    let calls = 0;
    const produce = async () => {
      calls++;
      return { answer: 42 };
    };
    expect(await c.memo("k1", produce)).toEqual({ answer: 42 });
    expect(await c.memo("k1", produce)).toEqual({ answer: 42 });
    expect(await c.memo("k2", produce)).toEqual({ answer: 42 });
    expect(calls).toBe(2);
    expect(c.has("k1")).toBe(true);
    expect(c.get<{ answer: number }>("k1")?.answer).toBe(42);
  });

  test("entries are stored under a two-level directory and survive a new instance", () => {
    const d = tmp();
    const key = cacheKey("stable");
    new Cache(d).set(key, "v");
    expect(fs.existsSync(path.join(d, key.slice(0, 2), `${key}.json`))).toBe(true);
    expect(new Cache(d).get<string>(key)).toBe("v");
  });

  test("a corrupt file is treated as a miss and removed", () => {
    const d = tmp();
    const key = cacheKey("broken");
    const file = path.join(d, key.slice(0, 2), `${key}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    const c = new Cache(d);
    expect(c.get(key)).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });

  test("clear empties the directory", () => {
    const d = tmp();
    const c = new Cache(d);
    c.set(cacheKey(1), 1);
    c.set(cacheKey(2), 2);
    c.clear();
    expect(c.has(cacheKey(1))).toBe(false);
    expect(fs.readdirSync(d)).toHaveLength(0);
  });
});
