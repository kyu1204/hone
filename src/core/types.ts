// Core data model for hone. See docs/work-orders/T-002.md for the field contract.
// Messages follow the OpenAI chat schema so Docent, Inspect and most importers map 1:1.

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type Role = "system" | "user" | "assistant" | "tool";
export const ROLES: readonly Role[] = ["system", "user", "assistant", "tool"];

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export type SpanKind = "llm" | "tool" | "retrieval" | "agent" | "custom";
export const SPAN_KINDS: readonly SpanKind[] = ["llm", "tool", "retrieval", "agent", "custom"];

export interface Span {
  id: string;
  parentId?: string;
  kind: SpanKind;
  name: string;
  startedAt: string;
  endedAt?: string;
  input?: unknown;
  output?: unknown;
  attrs?: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Artifacts {
  diff?: string;
  files?: Record<string, string>;
  stdout?: string;
  stderr?: string;
}

export interface Trace {
  id: string;
  caseId: string;
  targetId: string;
  trial: number;
  startedAt: string;
  endedAt: string;
  messages: ChatMessage[];
  spans: Span[];
  output: unknown;
  artifacts?: Artifacts;
  usage: Usage;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface Case {
  id: string;
  input: unknown;
  expected?: unknown;
  rubric?: string;
  tags?: string[];
  cluster?: string;
  meta?: Record<string, unknown>;
}

export interface Score {
  scorer: string;
  /** 0..1 */
  value: number;
  pass: boolean | null;
  reason?: string;
  evidence?: unknown[];
  costUsd?: number;
}

export type TrialFlag = "reward-hack" | "cached" | "timeout" | `forked-from:${string}`;

export interface Trial {
  id: string;
  runId: string;
  trace: Trace;
  scores: Score[];
  flags: TrialFlag[];
  pass: boolean | null;
  costUsd: number;
}

export interface Run {
  id: string;
  createdAt: string;
  configHash: string;
  targets: string[];
  caseIds: string[];
  summary?: Record<string, unknown>;
}

export interface FailureCode {
  code: string;
  axis: "system" | "role" | "domain";
  definition: string;
  evidencePatterns: string[];
}

export interface Verdict {
  caseId: string;
  targetId: string;
  n: number;
  passes: number;
  passAt1: number;
  passHatK: Record<number, number>;
  ci: [number, number];
  noise?: number;
}

// ---------------------------------------------------------------------------
// Runtime guards. Hand-written so the package stays dependency-free; the
// error message always names the first failing path, e.g. trace.messages[2].role.

export class ValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ValidationError";
  }
}

// A function declaration (not a const arrow) so TypeScript narrows after `fail(...)` calls.
function fail(path: string, msg: string): never {
  throw new ValidationError(path, msg);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function str(x: unknown, path: string): string {
  return typeof x === "string" ? x : fail(path, "expected string");
}
function num(x: unknown, path: string): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fail(path, "expected finite number");
}
function optStr(x: unknown, path: string): void {
  if (x !== undefined) str(x, path);
}
function optObj(x: unknown, path: string): void {
  if (x !== undefined && !isObj(x)) fail(path, "expected object");
}
function arr(x: unknown, path: string): unknown[] {
  return Array.isArray(x) ? x : fail(path, "expected array");
}
function oneOf<T extends string>(x: unknown, allowed: readonly T[], path: string): T {
  return (allowed as readonly string[]).includes(x as string) ? (x as T) : fail(path, `expected one of ${allowed.join(", ")}`);
}

function checkToolCall(x: unknown, path: string): void {
  if (!isObj(x)) fail(path, "expected object");
  str(x.id, `${path}.id`);
  oneOf(x.type, ["function"] as const, `${path}.type`);
  if (!isObj(x.function)) fail(`${path}.function`, "expected object");
  str(x.function.name, `${path}.function.name`);
  str(x.function.arguments, `${path}.function.arguments`);
}

function checkContent(x: unknown, path: string): void {
  if (typeof x === "string") return;
  const parts = arr(x, path);
  parts.forEach((p, i) => {
    const pp = `${path}[${i}]`;
    if (!isObj(p)) fail(pp, "expected object");
    const type = oneOf(p.type, ["text", "image_url"] as const, `${pp}.type`);
    if (type === "text") str(p.text, `${pp}.text`);
    else {
      if (!isObj(p.image_url)) fail(`${pp}.image_url`, "expected object");
      str(p.image_url.url, `${pp}.image_url.url`);
    }
  });
}

function checkMessage(x: unknown, path: string): void {
  if (!isObj(x)) fail(path, "expected object");
  oneOf(x.role, ROLES, `${path}.role`);
  checkContent(x.content, `${path}.content`);
  if (x.tool_calls !== undefined) arr(x.tool_calls, `${path}.tool_calls`).forEach((c, i) => checkToolCall(c, `${path}.tool_calls[${i}]`));
  optStr(x.tool_call_id, `${path}.tool_call_id`);
  optStr(x.name, `${path}.name`);
}

function checkSpan(x: unknown, path: string): void {
  if (!isObj(x)) fail(path, "expected object");
  str(x.id, `${path}.id`);
  optStr(x.parentId, `${path}.parentId`);
  oneOf(x.kind, SPAN_KINDS, `${path}.kind`);
  str(x.name, `${path}.name`);
  str(x.startedAt, `${path}.startedAt`);
  optStr(x.endedAt, `${path}.endedAt`);
  optObj(x.attrs, `${path}.attrs`);
}

function checkUsage(x: unknown, path: string): void {
  if (!isObj(x)) fail(path, "expected object");
  num(x.inputTokens, `${path}.inputTokens`);
  num(x.outputTokens, `${path}.outputTokens`);
  num(x.costUsd, `${path}.costUsd`);
}

export function assertTrace(x: unknown, path = "trace"): asserts x is Trace {
  if (!isObj(x)) fail(path, "expected object");
  str(x.id, `${path}.id`);
  str(x.caseId, `${path}.caseId`);
  str(x.targetId, `${path}.targetId`);
  num(x.trial, `${path}.trial`);
  str(x.startedAt, `${path}.startedAt`);
  str(x.endedAt, `${path}.endedAt`);
  arr(x.messages, `${path}.messages`).forEach((m, i) => checkMessage(m, `${path}.messages[${i}]`));
  arr(x.spans, `${path}.spans`).forEach((s, i) => checkSpan(s, `${path}.spans[${i}]`));
  if (!("output" in x)) fail(`${path}.output`, "missing");
  checkUsage(x.usage, `${path}.usage`);
  if (x.artifacts !== undefined) {
    if (!isObj(x.artifacts)) fail(`${path}.artifacts`, "expected object");
    optStr(x.artifacts.diff, `${path}.artifacts.diff`);
    optStr(x.artifacts.stdout, `${path}.artifacts.stdout`);
    optStr(x.artifacts.stderr, `${path}.artifacts.stderr`);
    optObj(x.artifacts.files, `${path}.artifacts.files`);
  }
  optStr(x.error, `${path}.error`);
  optObj(x.meta, `${path}.meta`);
}

export function isTrace(x: unknown): x is Trace {
  try {
    assertTrace(x);
    return true;
  } catch {
    return false;
  }
}

export function assertCase(x: unknown, path = "case"): asserts x is Case {
  if (!isObj(x)) fail(path, "expected object");
  str(x.id, `${path}.id`);
  if (!("input" in x)) fail(`${path}.input`, "missing");
  optStr(x.rubric, `${path}.rubric`);
  optStr(x.cluster, `${path}.cluster`);
  if (x.tags !== undefined) arr(x.tags, `${path}.tags`).forEach((t, i) => str(t, `${path}.tags[${i}]`));
  optObj(x.meta, `${path}.meta`);
}

export function isCase(x: unknown): x is Case {
  try {
    assertCase(x);
    return true;
  } catch {
    return false;
  }
}
