// An in-house helpdesk agent, the same one in LangChain and in Strands, checked against six house rules.
//   uv sync && export ANTHROPIC_API_KEY=...    the agents call a model on every trial
//   hone test                                  both frameworks side by side
//   HONE_AGENT=langchain hone sharpen          improve one of them
import { defineConfig, type HoneConfig } from "../../src/index.ts"; // in your project: from "honed"

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

export default defineConfig({
  targets: Object.fromEntries(Object.entries(agents).filter(([id]) => !only || only === id).map(([id, module]) => [id, target(module)])),
  cases: "evals/*.yaml",
  trials: 2,
  concurrency: 6,
  // reads what each case expects of the conversation: tools called and not, their order and arguments, what the
  // answer says; the reason of a failure names the rule that was broken, which the diagnosis and the rewrites are built from
  scorers: [{ name: "agent" }],
  sharpen: {
    // the one text hone may rewrite: the system prompt
    text: { seed: PROMPT, apply: (c, text) => withParams(c, { system_prompt: text }) },
    // a setting to weigh against it: the larger model with the same prompt, at three times the price
    variants: { "model: sonnet": (c) => withParams(c, { model: "claude-sonnet-5-5" }) },
  },
});
