import * as fs from "node:fs";
import * as path from "node:path";
import type { ScorerSpec } from "../core/config";
import type { ChatMessage, Score, Trace } from "../core/types";
import { registerScorerKind, type ScoreContext, type Scorer } from "./scorer";

type Spec = ScorerSpec & Record<string, unknown>;

const text = (x: unknown): string => (typeof x === "string" ? x : x === undefined ? "" : JSON.stringify(x));
const ratio = (hits: number, total: number): number => (total === 0 ? 1 : hits / total);
const name = (spec: Spec, kind: string): string => String(spec.id ?? kind);

function fromCase(c: ScoreContext["case"], field: string): unknown {
  return field.split(".").reduce<unknown>((acc, k) => (typeof acc === "object" && acc !== null ? (acc as Record<string, unknown>)[k] : undefined), c);
}

function normalize(x: unknown, mode: string | undefined): unknown {
  if (mode === "json") {
    const v = typeof x === "string" ? (() => { try { return JSON.parse(x) as unknown; } catch { return x; } })() : x;
    return JSON.stringify(sortKeys(v));
  }
  let s = text(x);
  if (mode?.includes("trim")) s = s.trim();
  if (mode?.includes("lower")) s = s.toLowerCase();
  return s;
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (typeof v === "object" && v !== null) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

function toolNames(trace: Trace): string[] {
  const fromMessages = trace.messages.flatMap((m) => m.tool_calls?.map((c) => c.function.name) ?? []);
  if (fromMessages.length) return fromMessages;
  return trace.spans.filter((s) => s.kind === "tool").map((s) => s.name);
}

function regexTargetText(trace: Trace, target: string): string {
  switch (target) {
    case "files":
      return [...Object.entries(trace.artifacts?.files ?? {}).map(([f, c]) => `${f}\n${c}`), trace.artifacts?.diff ?? ""].join("\n");
    case "trace":
      return JSON.stringify(trace.messages);
    case "stdout":
      return `${trace.artifacts?.stdout ?? ""}\n${trace.artifacts?.stderr ?? ""}`;
    default:
      return text(trace.output);
  }
}

// --- json schema (small subset, no dependency) -------------------------------

type Schema = Record<string, unknown>;
function validateSchema(value: unknown, schema: Schema, p: string): string | undefined {
  const type = schema.type as string | undefined;
  const is = (t: string): boolean =>
    t === "integer" ? Number.isInteger(value) : t === "number" ? typeof value === "number" : t === "array" ? Array.isArray(value) : t === "null" ? value === null : t === "object" ? typeof value === "object" && value !== null && !Array.isArray(value) : typeof value === t;
  if (type && !(Array.isArray(type) ? type.some(is) : is(type))) return `${p}: expected ${String(type)}`;
  if (schema.enum && !(schema.enum as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(value))) return `${p}: not in enum`;
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return `${p}: below minimum ${schema.minimum}`;
    if (typeof schema.maximum === "number" && value > schema.maximum) return `${p}: above maximum ${schema.maximum}`;
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return `${p}: shorter than ${schema.minLength}`;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return `${p}: longer than ${schema.maxLength}`;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) return `${p}: does not match ${schema.pattern}`;
  }
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = validateSchema(value[i], schema.items as Schema, `${p}[${i}]`);
      if (err) return err;
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties as Record<string, Schema> | undefined) ?? {};
    for (const r of (schema.required as string[] | undefined) ?? []) if (!(r in obj)) return `${p}.${r}: required`;
    for (const [k, sub] of Object.entries(props)) {
      if (k in obj) {
        const err = validateSchema(obj[k], sub, `${p}.${k}`);
        if (err) return err;
      }
    }
    if (schema.additionalProperties === false) for (const k of Object.keys(obj)) if (!(k in props)) return `${p}.${k}: additional property not allowed`;
  }
  return undefined;
}

// --- scorers -------------------------------------------------------------------

function exact(spec: Spec): Scorer {
  return {
    name: name(spec, "exact"),
    score({ case: c, trace }) {
      const expected = "expected" in spec ? spec.expected : fromCase(c, String(spec.caseField ?? "expected"));
      const mode = spec.normalize as string | undefined;
      const pass = normalize(trace.output, mode) === normalize(expected, mode);
      return { scorer: "", value: pass ? 1 : 0, pass, reason: pass ? "output equals expected" : "output differs from expected", evidence: [{ expected, output: trace.output }] };
    },
  };
}

function contains(spec: Spec): Scorer {
  return {
    name: name(spec, "contains"),
    score({ case: c, trace }) {
      const raw = spec.text ?? fromCase(c, String(spec.caseField ?? "expected"));
      const needles = (Array.isArray(raw) ? raw : [raw]).map(text);
      let hay = text(trace.output);
      if (spec.ignoreCase) hay = hay.toLowerCase();
      const hits = needles.filter((n) => hay.includes(spec.ignoreCase ? n.toLowerCase() : n));
      const all = spec.all !== false;
      const pass = all ? hits.length === needles.length : hits.length > 0;
      return { scorer: "", value: ratio(hits.length, needles.length), pass, reason: `${hits.length}/${needles.length} substrings found`, evidence: [{ missing: needles.filter((n) => !hits.includes(n)) }] };
    },
  };
}

function regex(spec: Spec): Scorer {
  return {
    name: name(spec, "regex"),
    score({ trace }) {
      const re = new RegExp(String(spec.pattern), `g${String(spec.flags ?? "")}`);
      const hay = regexTargetText(trace, String(spec.target ?? "output"));
      const matches = [...hay.matchAll(re)].map((m) => m[0]);
      const mode = String(spec.match ?? "contains");
      let pass: boolean;
      if (mode === "not_contains") pass = matches.length === 0;
      else if (mode.startsWith("count:")) pass = matches.length === Number(mode.slice(6));
      else pass = matches.length > 0;
      return { scorer: "", value: pass ? 1 : 0, pass, reason: `${matches.length} match(es) for /${String(spec.pattern)}/ in ${String(spec.target ?? "output")}`, evidence: [{ matches: matches.slice(0, 10) }] };
    },
  };
}

function jsonSchema(spec: Spec): Scorer {
  return {
    name: name(spec, "json-schema"),
    score({ trace }) {
      let value = trace.output;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          return { scorer: "", value: 0, pass: false, reason: "output is not valid JSON" };
        }
      }
      const err = validateSchema(value, spec.schema as Schema, "$");
      return { scorer: "", value: err ? 0 : 1, pass: !err, reason: err ?? "output matches schema" };
    },
  };
}

function toolUsed(spec: Spec): Scorer {
  return {
    name: name(spec, "tool_used"),
    score({ trace }) {
      const wanted = (Array.isArray(spec.tool) ? spec.tool : [spec.tool]).map(String);
      const used = new Set(toolNames(trace));
      const hits = wanted.filter((t) => used.has(t));
      if (spec.not) {
        const pass = hits.length === 0;
        return { scorer: "", value: pass ? 1 : 0, pass, reason: pass ? "forbidden tools not used" : `forbidden tools used: ${hits.join(", ")}`, evidence: [{ used: [...used] }] };
      }
      const pass = spec.all === false ? hits.length > 0 : hits.length === wanted.length;
      return { scorer: "", value: ratio(hits.length, wanted.length), pass, reason: `${hits.length}/${wanted.length} tools used`, evidence: [{ used: [...used], missing: wanted.filter((t) => !used.has(t)) }] };
    },
  };
}

function toolOrder(spec: Spec): Scorer {
  return {
    name: name(spec, "tool_order"),
    score({ trace }) {
      const want = (spec.tools as string[]).map(String);
      const got = toolNames(trace);
      let pass: boolean;
      if (spec.strict) pass = got.length === want.length && got.every((t, i) => t === want[i]);
      else {
        let i = 0;
        for (const t of got) if (t === want[i]) i++;
        pass = i === want.length;
      }
      return { scorer: "", value: pass ? 1 : 0, pass, reason: pass ? "tool order matches" : `expected ${want.join(" > ")}, got ${got.join(" > ")}`, evidence: [{ got }] };
    },
  };
}

function stepCount(spec: Spec): Scorer {
  return {
    name: name(spec, "step_count"),
    score({ trace }) {
      const calls = trace.messages.reduce((n, m) => n + (m.role === "assistant" ? (m.tool_calls?.length ?? 0) : 0), 0);
      const steps = Math.max(calls, trace.spans.filter((s) => s.kind === "tool").length);
      const max = spec.max as number | undefined;
      const min = spec.min as number | undefined;
      const pass = (max === undefined || steps <= max) && (min === undefined || steps >= min);
      return { scorer: "", value: pass ? 1 : 0, pass, reason: `${steps} tool step(s)`, evidence: [{ steps }] };
    },
  };
}

function cost(spec: Spec): Scorer {
  return {
    name: name(spec, "cost"),
    score({ trace }) {
      const pass = trace.usage.costUsd <= Number(spec.maxUsd);
      return { scorer: "", value: pass ? 1 : 0, pass, reason: `cost $${trace.usage.costUsd.toFixed(4)} vs max $${String(spec.maxUsd)}` };
    },
  };
}

function latency(spec: Spec): Scorer {
  return {
    name: name(spec, "latency"),
    score({ trace }) {
      const ms = Date.parse(trace.endedAt) - Date.parse(trace.startedAt);
      const pass = ms <= Number(spec.maxMs);
      return { scorer: "", value: pass ? 1 : 0, pass, reason: `${ms}ms vs max ${String(spec.maxMs)}ms`, evidence: [{ ms }] };
    },
  };
}

function fileExists(spec: Spec): Scorer {
  return {
    name: name(spec, "file_exists"),
    score({ trace }) {
      const paths = (Array.isArray(spec.path) ? spec.path : [spec.path]).map(String);
      const inFiles = new Set(Object.keys(trace.artifacts?.files ?? {}));
      const inDiff = new Set([...(trace.artifacts?.diff ?? "").matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]!));
      const ws = (spec.workspace as string | undefined) ?? (trace.meta?.workspace as string | undefined);
      const hits = paths.filter((p) => inFiles.has(p) || inDiff.has(p) || (ws !== undefined && fs.existsSync(path.join(ws, p))));
      const pass = hits.length === paths.length;
      return { scorer: "", value: ratio(hits.length, paths.length), pass, reason: `${hits.length}/${paths.length} files present`, evidence: [{ missing: paths.filter((p) => !hits.includes(p)) }] };
    },
  };
}

function testCommand(spec: Spec): Scorer {
  return {
    name: name(spec, "test_command"),
    cacheKeyExtra: () => Symbol.for("no-cache"),
    async score({ trace }) {
      const cwd = (spec.cwd as string | undefined) ?? (trace.meta?.workspace as string | undefined);
      if (!cwd || !fs.existsSync(cwd)) return { scorer: "", value: 0, pass: null, reason: "no workspace to run the test command in" };
      const proc = Bun.spawn(spec.command as string[], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
      const timer = setTimeout(() => proc.kill("SIGKILL"), Number(spec.timeoutMs ?? 300_000));
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      clearTimeout(timer);
      const pass = code === Number(spec.passOn ?? 0);
      const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-20);
      return { scorer: "", value: pass ? 1 : 0, pass, reason: `exit code ${code}`, evidence: [{ exitCode: code, tail }] };
    },
  };
}

export const DETERMINISTIC_KINDS: Record<string, (spec: Spec) => Scorer> = {
  exact,
  contains,
  regex,
  "json-schema": jsonSchema,
  tool_used: toolUsed,
  tool_order: toolOrder,
  step_count: stepCount,
  cost,
  latency,
  file_exists: fileExists,
  test_command: testCommand,
};

for (const [kind, factory] of Object.entries(DETERMINISTIC_KINDS)) registerScorerKind(kind, (spec) => factory(spec as Spec));

export type { ChatMessage, Score };
