import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertCase, type Case, ValidationError } from "./types";

/** Opaque until each adapter registers its own spec type (P1, P2). */
export interface TargetSpec {
  kind: string;
  id?: string;
  [k: string]: unknown;
}

export interface ScorerSpec {
  name: string;
  [k: string]: unknown;
}

export interface GateSpec {
  passHatK?: { k: number; min: number };
  passAt1?: { min: number };
  costUsd?: { max: number };
  rewardHack?: "fail" | "warn" | "ignore";
}

export interface HoneConfig {
  targets: Record<string, TargetSpec>;
  cases: string | string[] | Case[];
  trials?: number;
  adaptive?: { ciWidth: number; maxTrials: number };
  scorers: ScorerSpec[];
  gates?: GateSpec;
  concurrency?: number;
  cacheDir?: string;
  /** Named pure transforms of the config, measured by `hone ablate`. */
  ablations?: Record<string, (config: HoneConfig) => HoneConfig>;
}

/** Identity with types: lets hone.config.ts get completion and checking. */
export function defineConfig(c: HoneConfig): HoneConfig {
  return c;
}

export class ConfigNotFound extends Error {
  constructor(cwd: string) {
    super(`no hone.config.{ts,js,mjs} in ${cwd}. Run \`hone init\` to create one.`);
    this.name = "ConfigNotFound";
  }
}

const CONFIG_NAMES = ["hone.config.ts", "hone.config.js", "hone.config.mjs"];

export async function loadConfig(cwd = process.cwd()): Promise<{ config: HoneConfig; path: string; hash: string }> {
  const file = CONFIG_NAMES.map((n) => path.join(cwd, n)).find((p) => fs.existsSync(p));
  if (!file) throw new ConfigNotFound(cwd);
  const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  // Cache-bust with the hash so a changed file is re-imported within one process.
  const mod = (await import(`${file}?${hash}`)) as { default?: HoneConfig };
  if (!mod.default || typeof mod.default !== "object") throw new Error(`${file}: default export is not a config object`);
  return { config: mod.default, path: file, hash };
}

function parseCaseFile(file: string): unknown[] {
  const text = fs.readFileSync(file, "utf8");
  const ext = path.extname(file);
  if (ext === ".jsonl") {
    return text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as unknown);
  }
  const parsed = ext === ".json" ? (JSON.parse(text) as unknown) : (Bun.YAML.parse(text) as unknown);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function loadCases(spec: HoneConfig["cases"], cwd = process.cwd()): Promise<Case[]> {
  if (Array.isArray(spec) && spec.every((s) => typeof s !== "string")) return spec as Case[];
  const globs = (Array.isArray(spec) ? spec : [spec]) as string[];
  const files = new Set<string>();
  for (const g of globs) for (const f of new Bun.Glob(g).scanSync({ cwd })) files.add(path.join(cwd, f));
  if (files.size === 0) throw new Error(`no case files matched ${globs.join(", ")} in ${cwd}`);

  const cases: Case[] = [];
  const seen = new Map<string, string>();
  for (const file of [...files].sort()) {
    const stem = path.basename(file, path.extname(file));
    const items = parseCaseFile(file);
    items.forEach((raw, i) => {
      const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
      const withId: unknown = obj && obj.id === undefined ? { ...obj, id: items.length === 1 ? stem : `${stem}#${i}` } : raw;
      try {
        assertCase(withId);
      } catch (e) {
        if (e instanceof ValidationError) throw new Error(`${file}: ${e.message}`);
        throw e;
      }
      const prev = seen.get(withId.id);
      if (prev) throw new Error(`duplicate case id "${withId.id}" in ${prev} and ${file}`);
      seen.set(withId.id, file);
      cases.push(withId);
    });
  }
  return cases;
}
