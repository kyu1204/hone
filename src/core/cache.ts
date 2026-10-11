import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** JSON with recursively sorted object keys and no whitespace. Arrays keep order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/** sha256 hex of the canonical JSON of `parts`. */
export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(canonicalJson(parts)).digest("hex");
}

interface Entry {
  key: string;
  storedAt: string;
  value: unknown;
}

/**
 * Content-addressed file cache: <dir>/<key[0:2]>/<key>.json.
 * Target outputs and judge verdicts both go through here, so changing a scorer
 * or a rubric never re-runs the target.
 */
export class Cache {
  constructor(readonly dir = path.join(".hone", "cache")) {}

  private file(key: string): string {
    return path.join(this.dir, key.slice(0, 2), `${key}.json`);
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Corrupt entries are deleted and reported as a miss; this never throws. */
  get<T = unknown>(key: string): T | undefined {
    const f = this.file(key);
    let text: string;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      return undefined;
    }
    try {
      const entry = JSON.parse(text) as Entry;
      if (entry.key !== key) throw new Error("key mismatch");
      return entry.value as T;
    } catch {
      fs.rmSync(f, { force: true });
      return undefined;
    }
  }

  /** Atomic write: temp file in the same directory, then rename. */
  set(key: string, value: unknown): void {
    const f = this.file(key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
    const entry: Entry = { key, storedAt: new Date().toISOString(), value };
    fs.writeFileSync(tmp, JSON.stringify(entry));
    fs.renameSync(tmp, f);
  }

  async memo<T>(key: string, produce: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await produce();
    this.set(key, value);
    return value;
  }

  clear(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }
}
