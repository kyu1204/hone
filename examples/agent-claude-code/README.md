# agent-claude-code

Evaluate a coding agent on tasks against a fixture repository.

```bash
cd examples/agent-claude-code
hone run                  # with `claude` on PATH: runs Claude Code in a copy of fixtures/repo per trial
hone explain <trialId>    # messages, tool calls, the diff, reward-hack signals
hone fork <trialId> --step 3 --content "..."   # re-run from an edited step
```

`hone.config.ts` picks the target: a `process` target (`agent: "claude-code"`) when `claude` is installed and `CI` is unset, otherwise a `replay` target over `fixtures/traces/*.json` (two recorded trajectories) so `hone ci` is green in CI. The scorers check that the agent ran a command (`tool_used Bash`), did not tamper with tests (`hack`), and reported passing tests. To record new replay traces, run live once and copy `.hone/runs/<run>/trials/*.json` traces into `fixtures/traces/`.

Other agents: set `agent` to `codex`, `opencode`, `aider`, or `generic` with a `command`.
