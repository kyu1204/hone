// An in-house helpdesk agent, the same one in LangChain and in Strands, checked against six house rules.
//   uv sync && export ANTHROPIC_API_KEY=...    the agents call a model on every trial
//   hone test                                  both frameworks side by side
//   HONE_AGENT=langchain hone sharpen          improve one of them
import { defineConfig, type HoneConfig, type ScoreContext } from "../../src/index.ts"; // in your project: from "hone-eval"

// The first version of the prompt, as first versions are.
const PROMPT = "You are the Acme internal helpdesk assistant. Help employees with their questions.";

const only = process.env.HONE_AGENT; // langchain | strands; both when unset
const agents = { langchain: "langchain_agent", strands: "strands_agent" };
const target = (module: string) => ({
  kind: "python",
  module,
  fn: "answer",
  cwd: import.meta.dir,
  python: `${import.meta.dir}/.venv/bin/python`,
  workers: 6,
  timeoutMs: 180_000,
  // what a change may alter; the agents read these from ctx.params
  params: { system_prompt: PROMPT, model: process.env.HONE_AGENT_MODEL ?? "claude-haiku-5-5" },
});
/** The config with `params` merged into every agent: how a new prompt or another model gets in. */
const withParams = (c: HoneConfig, params: Record<string, unknown>): HoneConfig => ({
  ...c,
  targets: Object.fromEntries(Object.entries(c.targets).map(([id, t]) => [id, { ...t, params: { ...(t.params as object), ...params } }])),
});

// ---- scorers: each reads the recorded conversation and names the rule that was broken, because the diagnosis and the
// rewrites are built from these reasons
interface Expected {
  tools?: string[];
  never?: string[];
  before?: [string, string];
  args?: Record<string, Record<string, string>>;
  says?: string[];
  never_says?: string[];
}
const calls = (ctx: ScoreContext): { name: string; args: Record<string, unknown> }[] =>
  ctx.trace.messages.flatMap((m) => m.tool_calls ?? []).map((c) => ({ name: c.function.name, args: JSON.parse(c.function.arguments || "{}") as Record<string, unknown> }));
const expected = (ctx: ScoreContext): Expected => (ctx.case.expected ?? {}) as Expected;
const verdict = (problems: string[], ok: string) => ({ pass: problems.length === 0, value: problems.length === 0 ? 1 : 0, reason: problems.join("; ") || ok });
const skip = { pass: null, value: 1, reason: "not checked for this case" };

const tools = (ctx: ScoreContext) => {
  const e = expected(ctx);
  if (!e.tools && !e.never && !e.before) return skip;
  const used = calls(ctx).map((c) => c.name);
  const problems = [
    ...(e.tools ?? []).filter((t) => !used.includes(t)).map((t) => `did not call ${t}`),
    ...(e.never ?? []).filter((t) => used.includes(t)).map((t) => `called ${t}, which this request does not allow`),
  ];
  if (e.before && used.includes(e.before[1]) && !(used.indexOf(e.before[0]) >= 0 && used.indexOf(e.before[0]) < used.indexOf(e.before[1]))) problems.push(`called ${e.before[1]} without ${e.before[0]} first`);
  return verdict(problems, "the right tools, in the right order");
};
const args = (ctx: ScoreContext) => {
  const e = expected(ctx);
  if (!e.args) return skip;
  const problems: string[] = [];
  for (const [tool, want] of Object.entries(e.args)) {
    const made = calls(ctx).filter((c) => c.name === tool);
    for (const [key, value] of Object.entries(want)) {
      const got = made.map((c) => String(c.args[key] ?? "").trim().toLowerCase());
      if (made.length && !got.includes(value)) problems.push(`${tool} was called with ${key} "${got.join('", "')}"; this request needs "${value}"`);
    }
  }
  return verdict(problems, "tool arguments as the rules require");
};
const answer = (ctx: ScoreContext) => {
  const e = expected(ctx);
  if (!e.says && !e.never_says) return skip;
  const text = String(ctx.trace.output ?? "").toLowerCase();
  const problems = [
    ...(e.says ?? []).filter((s) => !text.includes(s.toLowerCase())).map((s) => `the answer does not contain "${s}"`),
    ...(e.never_says ?? []).filter((s) => text.includes(s.toLowerCase())).map((s) => `the answer contains "${s}", which it must not`),
  ];
  return verdict(problems, "the answer says what it must");
};

export default defineConfig({
  targets: Object.fromEntries(Object.entries(agents).filter(([id]) => !only || only === id).map(([id, module]) => [id, target(module)])),
  cases: "evals/*.yaml",
  trials: 2,
  concurrency: 6,
  scorers: [
    { name: "fn", id: "tools", score: tools },
    { name: "fn", id: "args", score: args },
    { name: "fn", id: "answer", score: answer },
  ],
  sharpen: {
    // the one text hone may rewrite: the system prompt
    text: { seed: PROMPT, apply: (c, text) => withParams(c, { system_prompt: text }) },
    // a setting to weigh against it: the larger model with the same prompt, at three times the price
    variants: { "model: sonnet": (c) => withParams(c, { model: "claude-sonnet-5-5" }) },
  },
});
