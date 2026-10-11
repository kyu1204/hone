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

- [x] T-101 `targets/http.ts` request template, response mapping, `x-hone-trace` server spans (S)
- [x] T-102 `targets/fn.ts` TypeScript function target + `trace()` helper (S)
- [x] T-103 `targets/python.ts` subprocess JSON-lines bridge + `hone_py` helper (M)
- [x] T-104 `targets/process.ts` isolated workspace, agent presets, session log to messages, git diff capture, timeout (L)
- [x] T-105 `targets/mcp.ts` stdio MCP server target (M)
- [x] T-106 `targets/replay.ts` re-score existing traces (S)
- [x] T-107 `targets/docker.ts` Dockerfile or Harbor task directory (M)
- [x] T-108 `resume(prefix)` interface on fn/http/process targets (M)

## P2 Scorers (after P0, parts of P1)

- [x] T-201 Deterministic scorers: exact, contains, regex, json-schema, tool_used, tool_order, step_count, cost, latency, file_exists, test_command (M)
- [x] T-202 `scorers/hack.ts` reward-hack detector: diff rules + Jev confirmation (M)
- [x] T-203 `scorers/rag/*` citation presence, claim faithfulness, context recall/precision (M)
- [x] T-204 `scorers/consistency.ts` metamorphic scorer (M)
- [x] T-205 `scorers/judge/jev.ts` noul/score/choice wrappers, per-step fan-out, thresholds (S)
- [x] T-206 `scorers/judge/llm.ts` rubric judge with Unknown option, split dimensions, pairwise order swap (M)
- [x] T-207 Scorer result caching (S)

## P3 Stats (after P0)

- [x] T-301 Wilson and bootstrap intervals, pass@k and pass^k unbiased estimators (S)
- [x] T-302 Paired t, exact McNemar, CR1 clustered SE + ICC (M)
- [x] T-303 Holm-Bonferroni indistinguishable groups (S)
- [x] T-304 Power analysis (S)
- [x] T-305 Sequential stopping on interval width (S)
- [x] T-306 IRT 2PL estimation, Fisher-information ordering, noise metric (L)
- [x] T-307 Beta-Bernoulli Thompson sampling (S)

## P4 Runner and CLI (after P0 to P3)

- [x] T-401 `core/plan.ts` + `core/scheduler.ts` concurrency pool, isolation, retries, adaptive queue (L)
- [x] T-402 `core/executor.ts` cache, scorers, store wiring, flags (M)
- [x] T-403 `hone run` table, JSON, exit codes (S)
- [x] T-404 `hone compare` paired report (S)
- [x] T-405 `hone matrix` harness x model aggregation (S)
- [x] T-406 `hone bisect` git bisection with per-commit trials (M)
- [x] T-407 `hone ablate` component removal comparison (M)
- [x] T-408 `hone ci` per-axis thresholds, exit code, JUnit, PR comment (M)
- [x] T-409 `hone init` project detection scaffolding and key entry (M)
- [x] T-410 `hone power`, `hone explain`, `hone report` (M)

## P5 TUI (after P4)

- [x] T-501 `tui/app.tsx` shell: layout, keymap, theme, event subscription (M)
- [x] T-502 Matrix screen (M)
- [x] T-503 Trace viewer (L)
- [x] T-504 Diff screen (M)
- [x] T-505 Clusters, Calibrate, Candidates screens (M)
- [x] T-506 Fork screen (M)
- [x] T-507 Charts: braille sparklines, Pareto, Kitty graphics upgrade (M)
- [x] T-508 `hone serve ssh` read-only (S)

## P6 Analysis (after P2 to P4)

- [x] T-601 `analysis/cluster.ts` failure clustering (M)
- [x] T-602 `analysis/taxonomy.ts` taxonomy induction + Jev classification (L)
- [x] T-603 `analysis/diffTrace.ts` LCS alignment of tool-call signatures (S)
- [x] T-604 `analysis/calibrate.ts` fault injection per domain, detection rate, kappa (M)
- [x] T-605 `analysis/branchpoints.ts` fork candidate ranking (S)

## P7 Correction (after T-108, P3, P6)

- [x] T-701 `correct/fork.ts` prefix-pinned re-run (M)
- [x] T-702 `correct/evolve.ts` GEPA-lite (L)
- [x] T-703 `correct/optimize.ts` bandit allocation + paired verdict (M)
- [x] T-704 `io/export/rollouts.ts` (S)
- [x] T-705 `serve/reward.ts` HTTP reward server (S)
- [x] T-706 `serve/mcp.ts` stdio MCP server (M)

## P8 Ecosystem (after P0, P2)

- [x] T-801 Import Claude Code sessions as cases and traces (M)
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
| 2026-10-12 | T-101 | #13 | Target/RunContext/TargetOutput, toTrace, registry, http target (_hone field, x-hone-trace header, timeouts, version hash) |
| 2026-10-12 | T-102 | #14 | fn target: FnContext span/message/usage recorder, TargetOutput merge, resume seeds prefix |
| 2026-10-12 | T-103 | #15 | python target: long-lived `python -I hone_bridge.py` process, Context span/message/usage, restart on crash, bridge embedded as text import |
| 2026-10-12 | T-104 | #17 | process target: copy/worktree/none isolation, git diff incl. untracked, timeout kill, presets claude-code/codex/opencode/aider/generic, NDJSON parsers |
| 2026-10-12 | T-105 | #18 | mcp target: initialize handshake (2025-06-18), tools/call, structuredContent, isError, restart, version with serverInfo |
| 2026-10-12 | T-106 | #19 | replay target: inline or glob traces (json/jsonl), trial or random selection, version from file stats |
| 2026-10-12 | T-107 | #20 | docker target: build env, run with /tests and /logs mounts, agent exec, verifier, reward.txt/json; io/atif.ts ATIF-v1.7 both directions |
| 2026-10-12 | T-108 | #21 | resume(prefix): fn/http/python exact, process rendered-prefix; http test added, others landed with their targets. P1 complete |
| 2026-10-12 | T-201 | #23 | Scorer/ScoreContext contract, registry, runScorer; exact, contains, regex, json-schema (subset validator), tool_used, tool_order, step_count, cost, latency, file_exists, test_command |
| 2026-10-12 | T-202 | #24 | hack scorer: diff parser + rules test-modified/deleted, skip-inserted, assertion-weakened, expected-hardcoded, verifier-touched; Jev confirm -> undecided below threshold |
| 2026-10-12 | T-203 | #25 | rag.context_recall/precision, rag.citations, rag.faithfulness (claim split, noul per claim, 256-batch), rag.answer_relevance (score levels) |
| 2026-10-12 | T-204 | #26 | consistency scorer: paraphrase/reorder/noise mutations (deterministic, inapplicable ones skipped), exact or Jev comparison via ctx.runTarget |
| 2026-10-12 | T-205 | #27 | jev.noul / jev.score / jev.choice / jev.steps (one noul per assistant step, 256-batch, min or mean); state builders output/messages/trace/function |
| 2026-10-12 | T-206 | #28 | llm.rubric (dimensions, scale, unknown verdict, one JSON repair retry, fence stripping), llm.pairwise (swap orders, disagreement = tie) |
| 2026-10-12 | T-207 | #29 | cachedScorer: key = spec + cacheKeyExtra + case(id, input, expected, rubric) + trace(output, messages, spans sans timestamps, artifacts, error); hits cost 0 and are marked. P2 complete |
| 2026-10-12 | T-301 | #31 | dist (lgamma, inc. beta/gamma, AS241 quantile, t p/quantile), wilsonCi, meanCiClt, bootstrapCi (seeded), passAtK/passHatK, verdictFor; vectors match errorbars to 1e-9 |
| 2026-10-12 | T-302 | #32 | pairedDifference (t, p, CI, corr, variance reduction), mcnemarExact, clusterRobustSe/ICC/designEffect/withinBetween, compareTargets composition |
| 2026-10-12 | T-303 | #33 | holm(), leaderboard() with maximal-clique groups |
| 2026-10-12 | T-304 | #34 | noncentral t (AS 243), pairedPower/N/Mde, withDesign |
| 2026-10-12 | T-305 | #35 | shouldStop, nextCell (widest Wilson interval first) |
| 2026-10-12 | T-306 | #36 | fit2pl joint MAP, fisherInformation, orderCasesByInformation, caseNoise |
| 2026-10-12 | T-307 | #37 | BetaBandit Thompson sampling, allocate(). P3 complete |
| 2026-10-12 | T-401 | #39 | buildPlan (id/glob/tag filters), runPlan: worker pool, trial-major order, transient retries, adaptive widest-cell sampling with case:stopped, abort, RunSummary |
| 2026-10-12 | T-402 | #40 | createExecutor: target cache (input + version), toTrace, cached scorers with runTarget hook, flags cached/timeout/reward-hack, gate modes fail/warn/ignore, store.saveTrial |
| 2026-10-12 | T-403 | #41 | parseArgs, dispatcher, hone run: filters, adaptive flags, progress, matrix table, --json, gates (passAt1/passHatK/costUsd), --max-cost abort, exit codes 0/1/2/3 |
| 2026-10-12 | T-404 | #42 | hone compare: two targets in a run or one target across runs, paired diff/CI/p, McNemar, cluster-robust CI, verdict, --json |
| 2026-10-12 | T-405 | #42 | hone matrix: pass@1, pass^3, $/tokens/s per solve, timeouts, hacks, cached, Holm bands, --by model|agent |
| 2026-10-12 | T-406 | #43 | correct/bisect.ts: endpoints first, midpoint threshold, Wilson-based verdicts with extra rounds, worktree per probe; hone bisect runs the plan uncached inside each worktree |
| 2026-10-12 | T-407 | #44 | config.ablations transforms; correct/ablation.ts runs baseline + each ablation, paired compare per case, verdict helps/hurts/no effect, cost delta |
| 2026-10-12 | T-408 | #45 | performRun extracted; hone ci: config + flag gates (min-pass-at-1, min-pass-hat-k, max-cost, max-regression vs baseline paired), .hone/ci/last.json, JUnit, gh pr comment or markdown |
| 2026-10-12 | T-409 | #46 | detectProject (claude-code, fastapi, mcp, node-ai, fallback echo), renderConfig/renderCases, hone init with --yes/--no-keys/--force and key flags, ~/.config/hone/env 0600; index.ts exports defineConfig and types |
| 2026-10-12 | T-410 | #47 | hone power (pairs or MDE with design adjustments), hone explain (verdict, scores, messages, span tree, diff), hone report (self-contained HTML with matrix and per-trial details). P4 complete |
| 2026-10-12 | T-501 | #49 | OpenTUI 0.6 + React 19.3 deps, jsxImportSource; tui/state.ts external store (watch polling), app.tsx shell (header, footer keymap, help, screen keys, matrix preview), theme, hone tui + bare hone in a TTY; tests via @opentui/react/test-utils |
| 2026-10-12 | T-502 | #50 | matrix screen: grid with cellLabel dots/flags, selection, enter to trace, d diff pairing, s sort cycle, / filter input (keyboard suspended), c summary row |
| 2026-10-12 | T-503 | #51 | trace screen: traceEntries (scores, messages with tool calls, span tree with retrieval context), left list + right context pane, j/k/enter/e, / search with n, [ ] trials, f fork, D diff previous |
| 2026-10-12 | T-504 | #52 | tui/align.ts LCS over role:tool signatures with divergence index; DiffScreen side by side with muted prefix, highlighted divergence, n jump, tab swap, enter expand |
| 2026-10-12 | T-505 | #53 | ListDetail widget; clusters (analysis/clusters-<run>.json, enter opens trial), calibrate (calibration-<judge>.json interval bars, false alarms, kappa), candidates (evolve/optimize JSON, Pareto marker, enter diffs vs baseline); store.root and openTrialById |
| 2026-10-12 | T-506 | #54 | tui/forkRunner.ts forkTrial (resume or run with ctx.prefix, forked-from flag, meta.forkStep), fork screen (steps, inline edit, r run, d diff), hone tui loads config for fork options; global reload moved to R |
| 2026-10-12 | T-507 | #55 | widgets/chart.ts sparkline, braillePlot, bar, detectGraphics, kittyImageEscape + dependency-free PNG encoder and rasterScatter; charts screen (history, Pareto scatter, Wilson bars). Pixel rendering inside the OpenTUI layout deferred: escape builder exists, screen uses cells |
| 2026-10-12 | T-508 | #56 | serve/ssh.ts: host key via ssh-keygen (OpenSSH format for ssh2), one TuiStore + React root per session, connection counting; hone serve ssh --port --host --run --read-only. P5 complete |
| 2026-10-12 | T-601 | #58 | providers/embed.ts (OpenAI-compatible /embeddings or 512-dim hashed bag of words offline); analysis/cluster.ts summarise, k-means++ with cosine, TF-IDF top terms, chooseK; hone cluster writes analysis/clusters-<run>.json with provisional cluster-n codes |
| 2026-10-12 | T-602 | #59 | analysis/taxonomy.ts: induceTaxonomy (one chat call per cluster, kebab codes, merge with existing by code or Jev noul >= 0.8), classify (one Jev choice per trial over codes + other), .hone/taxonomy.json; hone cluster --induce / --classify write real codes with classification counts |
| 2026-10-12 | T-603 | #60 | tui/align.ts moved to analysis/diffTrace.ts; divergenceReport classifies aligned rows (identical, different-content, different-tool-args, missing-in-a/b); hone diff <a> <b> prints side-by-side rows with gap markers or --json |
| 2026-10-12 | T-604 | #61 | analysis/calibrate.ts: fault injectors per domain (rag unsupported-claim/wrong-citation, qa answer-swapped/negated, agent verification-removed/tool-result-swapped/premature-done), calibrate with Wilson detection rates, clean re-score false alarms, Cohen kappa vs labels; hone calibrate --scorer --domain --run --n --seed --labels --json writes analysis/calibration-<scorer>.json |
| 2026-10-12 | T-605 | #62 | analysis/branchpoints.ts rankBranchPoints (error spans, divergence from a passing sibling, differing tool results, last tool call, completion claim, early-step penalty), topSteps, pickSibling; fork screen marks the top 3 with ★; hone explain prints fork candidates with reasons. P6 complete |
| 2026-10-12 | T-701 | #64 | tui/forkRunner.ts moved to correct/fork.ts; loadForkDeps shared by hone tui and hone fork; hone fork <trial> [--step n --content/--file] [--json] re-runs from the edited prefix and prints verdict change, scores and divergence rows; without --step lists T-605 fork candidates |
| 2026-10-12 | T-702 | #65 | config.evolve { seed, apply }; correct/evolve.ts reflect (one chat call per candidate, JSON proposal), minibatch = parent failures + n passes with rejection, full run, Pareto front over pass@1 x cost, paired verdict (beats baseline only when p < alpha), .hone/evolve/<id>.json + texts; runConfig exported from ablation with trials and caseIds; hone evolve --budget --minibatch --trials --max-cost --alpha --no-cache --json |
| 2026-10-12 | T-703 | #66 | config.optimize named candidates; correct/optimize.ts: one run + executor per arm, Thompson rounds (allocate) on least-observed cells, stop on budget or P(best) >= confidence with minPerArm, verification top-up so baseline and the leader cover every case, paired verdict, .hone/optimize/<id>.json; hone optimize --budget --batch --confidence --alpha --min-per-arm --seed --no-cache --json |
| 2026-10-12 | T-704 | #67 | io/export/rollouts.ts: splitPrompt (prompt up to the last user turn before the first assistant turn), toRollout (trl prompt/completion or openai messages, reward = verdict / mean-score / one scorer, info with ids, scores, flags, cost, injectedFault), writeRollouts JSONL; hone export rollouts --run --out --pass-only --reward --format (other kinds reserved for T-803) |
| 2026-10-12 | T-705 | #68 | serve/reward.ts: Bun.serve with GET /health, POST /score (messages or output + case -> reward/pass/scores, scorer exceptions -> 500), POST /batch (ordered, concurrency 4), 400 on bad bodies; hone serve reward --port --host --scorer (serve command split into ssh/reward modes with a non-blocking test hook) |
| 2026-10-12 | T-706 | #69 | serve/mcp.ts: newline-delimited JSON-RPC 2.0 MCP server (initialize, ping, tools/list, tools/call; -32700/-32601/-32602; tool failures as isError) with tools hone_run, hone_list_runs, hone_matrix, hone_compare, hone_explain (+forkCandidates), hone_cluster, hone_fork, each delegating to the existing command with --json; serveStdio framing; hone serve mcp. P7 complete |
| 2026-10-12 | T-801 | #71 | targets/parsers/claudeCode.ts: recordsToParsed shared by the stream parser and session import (human turns option, per-message usage, timestamps); io/import/claudeCode.ts parseSession (case from the first human prompt, trace with meta sessionId/cwd/gitBranch/version/model/turns, cost from cost-state, diff/files artifacts from Edit/Write inputs), importClaudeSessions (dir scan newest first, limit, since, skipped), defaultProjectDir; hone import claude-code [files] --project --limit --since --cases --json creates one run so sessions show in the matrix |
