# Contributing to hone

Thanks for looking. v0.1.0 is being built in public from [`WORKPLAN.md`](./WORKPLAN.md); each task has a work order under `docs/work-orders/` and lands as a pull request.

## Ground rules

- Work on a branch, open a pull request. Nothing is committed to `main` directly.
- Tests first. A change to `src/` comes with a failing test that the change makes pass (`bun test`).
- One logical change per commit. Feature, refactor, formatting and docs are separate commits.
- `bun run check` must be green: lint, typecheck, tests.

## Developer Certificate of Origin

Contributions are accepted under the [Developer Certificate of Origin 1.1](https://developercertificate.org/). By signing off a commit you certify that you wrote the change or have the right to submit it under the project license (Apache-2.0).

Sign off every commit:

```bash
git commit -s -m "feat: ..."
```

This adds a `Signed-off-by: Your Name <you@example.com>` trailer. There is no CLA.

## Reporting eval pain

Issues that describe a real evaluation problem are the most useful thing you can send before v0.1.0 lands: a trace that fooled your judge, a harness comparison you wish you could run, a format you need imported.
