# steps: one step on its own

`hone sharpen` runs these for you. Use them to look into what it reported or when only one step is wanted. `hone help all` lists them; `hone <command> --help` gives the options.

| Want | Command |
| --- | --- |
| Whether two targets really differ, case by case | `hone compare <targetA> <targetB>` (or `--run A --run B <target>` for one target across two runs) |
| One row per target: pass rate, cost, time, which targets differ | `hone matrix` |
| One trial in full: verdict, scores, messages | `hone explain <trialId>` |
| Where two trials went different ways | `hone diff <trialA> <trialB>` |
| The failure modes of a run | `hone cluster` (`--induce` names them with a model) |
| Whether a judge scorer can be trusted | `hone calibrate --scorer <name>`: plants known faults in passing trials and counts what the judge catches |
| What one part of the config is worth | `hone ablate`: removes each declared part and measures the difference |
| Re-run one trial from an edited step | `hone fork <trialId> --step N --content "..."` |
| The commit that broke a case | `hone bisect --good <rev> --bad <rev>` |
| How many cases a difference of a given size needs | `hone power --effect d` or `hone power --n N` |
| Rewrites of the declared text only, or the declared variants only | `hone evolve`, `hone optimize` |
| Results in another format | `hone export <otel, docent, junit, html or rollouts>`, `hone test --report` |
| Other tools' results, or Claude Code sessions, in the store | `hone import ...` |
| The results in the terminal | `hone` (or `hone tui`) |

Every command that compares ends with a verdict and says `no measurable effect` when the data do not support a claim. Report that wording.
