# qa-fn

The smallest hone setup: a plain function as the target, deterministic scorers, one gate.

```bash
cd examples/qa-fn
hone run            # 5 cases x 2 trials
hone matrix         # pass@1 with intervals
hone ci             # exits non-zero when pass@1 < 0.9
```

`hone.config.ts` points `targets.qa` at `answer()`; swap it for your own function, HTTP endpoint or agent. Cases live in `evals/cases.yaml` (`id`, `input`, `expected`). The `consistency` scorer re-runs the target on whitespace and case mutations of the input and fails when the answer changes.

In your own project import from `hone-eval` instead of `../../src/index.ts`.
