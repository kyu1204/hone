import * as fs from "node:fs";
import * as path from "node:path";
import type { TargetSpec } from "../core/config";
import { cacheKey } from "../core/cache";
import { assertTrace, type Trace, ValidationError } from "../core/types";
import { registerTargetKind, type RunContext, type Target, type TargetOutput } from "./target";

export interface ReplayTargetSpec extends TargetSpec {
  kind: "replay";
  traces: string | string[] | Trace[];
  select?: "trial" | "random";
}

function expandGlobs(globs: string[]): string[] {
  const files = new Set<string>();
  for (const g of globs) {
    const abs = path.isAbsolute(g);
    const base = abs ? path.parse(g).root : process.cwd();
    const pattern = abs ? g.slice(base.length) : g;
    for (const f of new Bun.Glob(pattern).scanSync({ cwd: base, absolute: true })) files.add(f);
  }
  return [...files].sort();
}

function loadFile(file: string): Trace[] {
  const text = fs.readFileSync(file, "utf8");
  const items: unknown[] = file.endsWith(".jsonl")
    ? text
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as unknown)
    : (() => {
        const parsed = JSON.parse(text) as unknown;
        return Array.isArray(parsed) ? parsed : [parsed];
      })();
  return items.map((t, i) => {
    try {
      assertTrace(t);
      return t;
    } catch (e) {
      if (e instanceof ValidationError) throw new Error(`${file}[${i}]: ${e.message}`);
      throw e;
    }
  });
}

export function replayTarget(id: string, spec: ReplayTargetSpec): Target {
  const inline = Array.isArray(spec.traces) && spec.traces.every((t) => typeof t !== "string") ? (spec.traces as Trace[]) : undefined;
  const globs = inline ? [] : ((Array.isArray(spec.traces) ? spec.traces : [spec.traces]) as string[]);
  const select = spec.select ?? "trial";

  const load = (): Trace[] => {
    if (inline) return inline;
    return expandGlobs(globs).flatMap(loadFile);
  };

  const run = async (_input: unknown, ctx: RunContext): Promise<TargetOutput> => {
    let traces: Trace[];
    try {
      traces = load().filter((t) => t.caseId === ctx.caseId);
    } catch (e) {
      return { output: null, error: e instanceof Error ? e.message : String(e) };
    }
    if (traces.length === 0) return { output: null, error: `no replay trace for case ${ctx.caseId}` };
    const picked =
      select === "random"
        ? traces[Math.floor(Math.random() * traces.length)]!
        : (traces.find((t) => t.trial === ctx.trial) ?? traces[ctx.trial % traces.length]!);
    const out: TargetOutput = {
      output: picked.output,
      messages: picked.messages,
      spans: picked.spans,
      usage: picked.usage,
      meta: { ...picked.meta, replayedFrom: picked.id },
    };
    if (picked.artifacts) out.artifacts = picked.artifacts;
    if (picked.error !== undefined) out.error = picked.error;
    return out;
  };

  return {
    id,
    kind: "replay",
    async version() {
      if (inline) return cacheKey({ kind: "replay", ids: inline.map((t) => t.id) });
      const stat = expandGlobs(globs).map((f) => {
        const s = fs.statSync(f);
        return [f, s.size, s.mtimeMs];
      });
      return cacheKey({ kind: "replay", files: stat });
    },
    run,
  };
}

registerTargetKind("replay", (id, spec) => replayTarget(id, spec as ReplayTargetSpec));
