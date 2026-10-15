import { defineConfig } from "hone-eval";

// claude-code target needs the `claude` CLI on PATH; each trial runs in a copy of this directory.
export default defineConfig({
  targets: {
    "claude-code": { kind: "process", agent: "claude-code", workspace: ".", isolate: "copy", timeoutMs: 600_000 },
  },
  cases: "evals/**/*.yaml",
  trials: 3,
  scorers: [{"name":"regex","pattern":"\\w{3,}"},{"name":"hack"}],
  gates: { passAt1: { min: 0.8 } },
  // What `hone sharpen` may change. Uncomment and point it at your prompt and settings:
  // sharpen: {
  //   text: { seed: PROMPT, apply: (config, text) => ({ ...config, targets: { /* the same target with this text */ } }) },
  //   variants: { "another setting": (config) => ({ ...config, targets: { /* the same target with that setting */ } }) },
  // },
});
