# hone v0.1.0 WORKPLAN

Single source of truth for the autonomous loop and for humans. One task, one PR, one entry in the progress log. Work orders live in `docs/work-orders/<ID>.md`; a task without a work order is not started.

Architecture and rationale: vault note `hone-v0-1-0-workplan` (minkyu), research `hone-research-2026-10`.

Sizes: S half a day, M a day, L two to three days. Phases in dependency order; tasks within a phase may run in parallel.

## P0 Foundation

- [x] T-001 Repo toolchain: Bun 1.3.14+, tsconfig, oxlint, bun test, `bun run check`, CI workflow (S)
- [x] T-002 `core/types.ts` data model + JSON schema export (S)
- [x] T-003 `core/config.ts` `defineConfig`, `hone.config.ts` loader, YAML/JSON case glob loader (M)
- [x] T-004 `core/cache.ts` content-addressed cache under `.hone/cache` (S)
- [x] T-005 `core/store.ts` run JSON files + `bun:sqlite` index with rebuild (M)
- [x] T-006 `core/events.ts` typed progress event bus (S)
- [x] T-007 `providers/jev.ts` System One client: noul/score/choice, batching, retry, timeout, rate limit, 3-level key resolution (M)
- [x] T-008 `providers/llm.ts` OpenAI-compatible + Anthropic chat client with cost table (S)
- [x] T-009 Compatibility research into `docs/compat.md`: Harbor task and result format, verifiers v1 API, OTel GenAI attribute names, Docent license, Jev request limits (S)

## P1 Targets (after P0)

- [ ] T-101 `targets/http.ts` request template, response mapping, `x-hone-trace` server spans (S)
- [ ] T-102 `targets/fn.ts` TypeScript function target + `trace()` helper (S)
- [ ] T-103 `targets/python.ts` subprocess JSON-lines bridge + `hone_py` helper (M)
- [ ] T-104 `targets/process.ts` isolated workspace, agent presets, session log to messages, git diff capture, timeout (L)
- [ ] T-105 `targets/mcp.ts` stdio MCP server target (M)
- [ ] T-106 `targets/replay.ts` re-score existing traces (S)
- [ ] T-107 `targets/docker.ts` Dockerfile or Harbor task directory (M)
- [ ] T-108 `resume(prefix)` interface on fn/http/process targets (M)

## P2 Scorers (after P0, parts of P1)

- [ ] T-201 Deterministic scorers: exact, contains, regex, json-schema, tool_used, tool_order, step_count, cost, latency, file_exists, test_command (M)
- [ ] T-202 `scorers/hack.ts` reward-hack detector: diff rules + Jev confirmation (M)
- [ ] T-203 `scorers/rag/*` citation presence, claim faithfulness, context recall/precision (M)
- [ ] T-204 `scorers/consistency.ts` metamorphic scorer (M)
- [ ] T-205 `scorers/judge/jev.ts` noul/score/choice wrappers, per-step fan-out, thresholds (S)
- [ ] T-206 `scorers/judge/llm.ts` rubric judge with Unknown option, split dimensions, pairwise order swap (M)
- [ ] T-207 Scorer result caching (S)

## P3 Stats (after P0)

- [ ] T-301 Wilson and bootstrap intervals, pass@k and pass^k unbiased estimators (S)
- [ ] T-302 Paired t, exact McNemar, CR1 clustered SE + ICC (M)
- [ ] T-303 Holm-Bonferroni indistinguishable groups (S)
- [ ] T-304 Power analysis (S)
- [ ] T-305 Sequential stopping on interval width (S)
- [ ] T-306 IRT 2PL estimation, Fisher-information ordering, noise metric (L)
- [ ] T-307 Beta-Bernoulli Thompson sampling (S)

## P4 Runner and CLI (after P0 to P3)

- [ ] T-401 `core/plan.ts` + `core/scheduler.ts` concurrency pool, isolation, retries, adaptive queue (L)
- [ ] T-402 `core/executor.ts` cache, scorers, store wiring, flags (M)
- [ ] T-403 `hone run` table, JSON, exit codes (S)
- [ ] T-404 `hone compare` paired report (S)
- [ ] T-405 `hone matrix` harness x model aggregation (S)
- [ ] T-406 `hone bisect` git bisection with per-commit trials (M)
- [ ] T-407 `hone ablate` component removal comparison (M)
- [ ] T-408 `hone ci` per-axis thresholds, exit code, JUnit, PR comment (M)
- [ ] T-409 `hone init` project detection scaffolding and key entry (M)
- [ ] T-410 `hone power`, `hone explain`, `hone report` (M)

## P5 TUI (after P4)

- [ ] T-501 `tui/app.tsx` shell: layout, keymap, theme, event subscription (M)
- [ ] T-502 Matrix screen (M)
- [ ] T-503 Trace viewer (L)
- [ ] T-504 Diff screen (M)
- [ ] T-505 Clusters, Calibrate, Candidates screens (M)
- [ ] T-506 Fork screen (M)
- [ ] T-507 Charts: braille sparklines, Pareto, Kitty graphics upgrade (M)
- [ ] T-508 `hone serve ssh` read-only (S)

## P6 Analysis (after P2 to P4)

- [ ] T-601 `analysis/cluster.ts` failure clustering (M)
- [ ] T-602 `analysis/taxonomy.ts` taxonomy induction + Jev classification (L)
- [ ] T-603 `analysis/diffTrace.ts` LCS alignment of tool-call signatures (S)
- [ ] T-604 `analysis/calibrate.ts` fault injection per domain, detection rate, kappa (M)
- [ ] T-605 `analysis/branchpoints.ts` fork candidate ranking (S)

## P7 Correction (after T-108, P3, P6)

- [ ] T-701 `correct/fork.ts` prefix-pinned re-run (M)
- [ ] T-702 `correct/evolve.ts` GEPA-lite (L)
- [ ] T-703 `correct/optimize.ts` bandit allocation + paired verdict (M)
- [ ] T-704 `io/export/rollouts.ts` (S)
- [ ] T-705 `serve/reward.ts` HTTP reward server (S)
- [ ] T-706 `serve/mcp.ts` stdio MCP server (M)

## P8 Ecosystem (after P0, P2)

- [ ] T-801 Import Claude Code sessions as cases and traces (M)
- [ ] T-802 Import Inspect, Docent, plugin-eval, Harbor, OTel (L)
- [ ] T-803 Export OTel GenAI, Docent, JUnit, HTML (M)
- [ ] T-804 `skills/SKILL.md`, shipped `docs/`, init opt-in install (S)

## P9 Release (after all)

- [ ] T-901 Five examples with passing suites (L)
- [ ] T-902 README demo gif, docs pages (M)
- [ ] T-903 `release.yml`: trusted publishing, compiled binaries, GitHub Release (M)
- [ ] T-904 Repository hardening (S)
- [ ] T-905 v0.1.0 tag, npm publish, launch posts (S)

## Progress log

| Date | Task | PR | Note |
|---|---|---|---|
| 2026-10-12 | bootstrap | #1 | harness guardrails, README, brand assets, Apache-2.0 + DCO |
| 2026-10-12 | T-001 | #3 | toolchain, CI, cli --version; bun run check green |
| 2026-10-12 | T-002 | #4 | types + assertTrace/assertCase guards, valid trace fixture |
| 2026-10-12 | T-003 | #5 | defineConfig, loadConfig with sha256 hash, loadCases yaml/json/jsonl with stem ids |
| 2026-10-12 | T-004 | #6 | canonicalJson, cacheKey, Cache.memo with atomic writes |
| 2026-10-12 | T-005 | #7 | Store: runs/trials JSON, sqlite index auto-rebuilt when missing |
| 2026-10-12 | T-006 | #8 | HoneEvents: on/once/off/emit/iterate, listener errors become log events |
| 2026-10-12 | T-007 | #9 | JevClient: noul/choice/score, 3-level key resolution, retry/backoff, timeout, semaphore |
| 2026-10-12 | T-008 | #10 | chat(): openai + anthropic wire formats, retries, pricing table with unknownPricing flag |
| 2026-10-12 | T-009 | #11 | docs/compat.md: ATIF-v1.7, verifiers v1 Taskset/Trace, OTel attribute table @6fd0d76, Docent Apache-2.0, Jev 400 questions ok, Inspect schema fixture |
