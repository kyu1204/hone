// The grammar of an improvement proposal. A file under sharpen/ calls change() once per idea, the way a test file
// calls test(); `hone sharpen` loads the files and evaluates every change. Who wrote the file does not matter: a person,
// or a coding agent that read the diagnosis.
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { HoneConfig } from "../core/config";

export interface ChangeSpec {
  /** The hypothesis: what is wrong, and why this fixes it. It goes into the ledger and the account. */
  why: string;
  /** A new version of the text declared in `config.sharpen.text`: the whole text. */
  text?: string;
  /** A paragraph for that text as it is: one rule, one instruction. The cycle stacks the additions that help, so two ideas stay two changes. */
  add?: string;
  /**
   * Any change a config can express: a setting, a model, another function or module for a target. New code goes into a
   * new file (or this one) and the config points at it. Never edit a file the baseline runs: there would be nothing
   * left to compare against.
   */
  config?: (config: HoneConfig) => HoneConfig;
}

export interface Change extends ChangeSpec {
  name: string;
  /** The file that declared it, relative to the project. */
  file?: string;
}

export const DEFAULT_CHANGE_GLOB = "sharpen/**/*.{ts,js,mjs}";

// On globalThis, not in this module: the published CLI is one bundle, while a project's change file imports the
// unbundled package. Two instances of this module have to see one registry.
interface Registry {
  changes: Change[];
  loading: boolean;
  /** What each file declared, by path and content hash: an unchanged module is not evaluated twice, so its calls do not run again. */
  seen: Map<string, Change[]>;
}
const KEY = Symbol.for("hone.changes");
const registry = (): Registry => {
  const g = globalThis as { [KEY]?: Registry };
  g[KEY] ??= { changes: [], loading: false, seen: new Map() };
  return g[KEY];
};

/** Declare one change. Call it at the top level of a file under `sharpen/`. */
export function change(name: string, spec: ChangeSpec): void {
  if (typeof name !== "string" || name.trim() === "") throw new Error("a change needs a name");
  const s = (spec ?? {}) as Partial<ChangeSpec>;
  const fail = (what: string): never => {
    throw new Error(`change "${name}": ${what}`);
  };
  if (typeof s.why !== "string" || s.why.trim() === "") fail("`why` says what is wrong and why this fixes it; it is required");
  if (s.text !== undefined && typeof s.text !== "string") fail("`text` is the new text, a string");
  if (s.add !== undefined && (typeof s.add !== "string" || s.add.trim() === "")) fail("`add` is a paragraph to add to the text; it is empty");
  if (s.text !== undefined && s.add !== undefined) fail("`text` is the whole new text and `add` a paragraph for the text as it is; give one of them");
  if (s.config !== undefined && typeof s.config !== "function") fail("`config` is a function from a config to a config");
  if (s.text === undefined && s.add === undefined && s.config === undefined) fail("give it something to try: `add`, `text` or a `config` function");
  const reg = registry();
  if (reg.loading) reg.changes.push({ name, why: s.why!, ...(s.text !== undefined ? { text: s.text } : {}), ...(s.add !== undefined ? { add: s.add } : {}), ...(s.config ? { config: s.config } : {}) });
}

/** Import every change file matched by `globs` (relative to `cwd`) and return the changes they declared, in path order. */
export async function loadChanges(cwd: string, globs: string | string[] = DEFAULT_CHANGE_GLOB): Promise<Change[]> {
  const files = new Set<string>();
  for (const g of [globs].flat()) for (const f of new Bun.Glob(g).scanSync({ cwd })) if (!/\.(test|d)\.[cm]?[jt]sx?$/.test(f)) files.add(f);
  const reg = registry();
  const out: Change[] = [];
  for (const rel of [...files].sort()) {
    const abs = path.join(cwd, rel);
    // the hash makes an edited file load again within one process
    const key = `${abs}?${createHash("sha256").update(fs.readFileSync(abs)).digest("hex")}`;
    if (!reg.seen.has(key)) {
      reg.changes = [];
      reg.loading = true;
      try {
        await import(key);
      } catch (e) {
        throw new Error(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        reg.loading = false;
      }
      reg.seen.set(key, reg.changes);
      reg.changes = [];
    }
    for (const c of reg.seen.get(key)!) {
      const twin = out.find((o) => o.name === c.name);
      if (twin) throw new Error(`two changes are named "${c.name}": ${twin.file} and ${rel}`);
      out.push({ ...c, file: rel });
    }
  }
  return out;
}
