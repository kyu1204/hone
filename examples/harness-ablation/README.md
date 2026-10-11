# harness-ablation

A toy "harness" (a rules text steering a solver) with every correction command wired up, all offline:

```bash
cd examples/harness-ablation
hone run                 # baseline: all rules on
hone ablate              # remove one rule at a time; paired delta per rule
hone optimize --budget 12 --batch 4   # Thompson sampling between two candidate rule sets, paired verdict
hone evolve --budget 2   # needs an LLM key: proposes rule rewrites from the failures
```

`ablations` removes one rule each; `optimize` names two alternative rule sets; `evolve.seed` starts from a single rule and lets the reflection step propose the rest. Read the verdict lines: a candidate "beats baseline" only when the paired test says so.
