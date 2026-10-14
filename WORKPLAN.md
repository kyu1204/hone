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
- [x] T-802 Import Inspect, Docent, plugin-eval, Harbor, OTel (L)
- [x] T-803 Export OTel GenAI, Docent, JUnit, HTML (M)
- [x] T-804 `skills/SKILL.md`, shipped `docs/`, init opt-in install (S)

## P9 Release (after all)

- [x] T-901 Five examples with passing suites (L)
- [x] T-902 README demo gif, docs pages (M)
- [x] T-903 `release.yml`: trusted publishing, compiled binaries, GitHub Release (M)
- [x] T-904 Repository hardening (S)
- [ ] T-905 v0.1.0 tag, npm publish, launch posts (S) BLOCKED: launch posts and awesome-list PRs need the maintainer. Done: hone-eval 0.1.0 on npm and the v0.1.0 GitHub Release with six binaries, both from the release workflow (a merged `release/vX.Y.Z` pull request releases; #136-#140).

## P10 One cycle, three commands (after P7)

Why: the two 2026-10 studies showed that a person was still chaining the steps and making the calls, and that twenty commands are too many to choose from.

- [x] T-1001 Three-command surface: `init`, `test`, `sharpen`; the rest behind `hone help all` (M)
- [x] T-1002 Config: one `sharpen` block (`text`, `variants`) replaces `evolve` and `optimize` (S)
- [x] T-1003 `hone sharpen`: split, measure, gates, diagnose, propose, verify, confirm on held-out cases, plain report (L)
- [x] T-1007 sharpen: try each variant again on top of a rewrite that became the best (S)
- [x] T-1004 The first five minutes: init scaffold, example, README, skill, docs (M)
- [x] T-1008 Change files: `change(name, { why, text, config })` under `sharpen/`, loaded and searched by the cycle (L)
- [x] T-1009 The diagnosis as a file a proposer can read; `--budget 0` diagnoses only (S)
- [x] T-1010 Coding agents: `hone init` installs the skill with topic references and registers the MCP server; `hone guide` (M)
- [x] T-1011 A held-out set wears out: count confirmations per split and raise the bar (S)
- [ ] T-1005 Proposals as patches from an agent hone starts itself; diagnosis by intervention; `--apply` (L) DEFERRED: a change file can already point the config at new code, and a coding agent writes change files through the skill (T-1008, T-1010). Reopen when a change has to edit files in place.
- [ ] T-1006 Replicate both studies with zero human decisions (M) BLOCKED: spends API credit and subscription quota; the maintainer sets the budget first.

## P11 Custom agents (after P10)

Why: the agents teams build in-house (LangChain, Strands) are where an evaluation cycle is hardest to set up and most needed.

- [x] T-1101 Python targets for custom agents: `params`, traces recorded from LangChain and Strands, concurrency (M)
- [x] T-1102 Example: an in-house helpdesk agent in LangChain and in Strands, 36 cases over six house rules (M)
- [x] T-1103 Benchmark: the cycle on both, by hone's own rewrites and by a coding agent (Codex) writing changes (M)
- [x] T-1104 `hone init` recognises LangChain and Strands projects (S)
- [x] T-1105 README rewritten around what hone is now, with a new demo recording (M)
- [x] T-1106 `hone sharpen --no-rewrites`: only the changes from files and the variants are judged (S)
- [x] T-1107 A winning rewrite is tried without the config change it was written on: the smaller change wins when it is as good (S)
- [x] T-1108 A change can add to the text (`add`), and the cycle stacks the additions that help (M)
- [x] T-1109 A cheaper candidate that is as good (within one standard error) is the winner (S)
- [x] T-1110 The search does not pay for a costlier variant before a text is found: rewrites are written on the baseline's price, the variant goes on top once (S)

## P12 The QA engineer (after P11)

Why: e2e's three layers, mapped onto evaluation: a grammar for cases, tools a coding agent can drive, and hone's own AI writing the cases, running them and reporting. No new command: the three stay `init`, `test`, `sharpen`. Drafting cases then outgrew `init` and became `hone draft` (T-1204).

- [x] T-1201 A case says what must hold in the agent's conversation: the `agent` scorer (S)
- [ ] T-1202 `hone try`: one message to the agent, the whole conversation back (S) DROPPED: no new command (the maintainer's call)
- [x] T-1203 `hone init --cases`: hone writes the cases from what the agent is for, runs them and reports (M)
- [x] T-1204 `hone draft`: drafting cases leaves `hone init` for a command of its own (S)

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
| 2026-10-12 | T-802 | #72 | io/otelAttrs.ts (semconv names + commit); io/import/{common,inspect,docent,pluginEval,harbor,otel}.ts with hand-written fixtures under test/fixtures/import; inspect (tolerant JSON, C/I/P mapping, epoch -> trial), docent (AgentRun/array/agent_runs, metadata scores), plugin-eval (prompt + graders/*.md -> cases + scorer specs), harbor (results.json + ATIF + reward fallback, job dirs), otel (OTLP attrs, kinds by operation, evaluation events, usage); hone import <kind> <path> --target --cases --json one run per import |
| 2026-10-12 | T-803 | #73 | io/export/{otel,docent,junit,html}.ts: OTLP spans (root invoke_agent with messages, ids, evaluation events; children by kind; deterministic ids; round trip with the importer), Docent AgentRuns (round trip), JUnit moved out of ci.ts (per-cell time), HTML renderer moved out of report.ts; hone export otel|docent|junit|html [--run] [--out] |
| 2026-10-12 | T-804 | #74 | skills/hone/SKILL.md (correction loop, reading results, MCP tools, rules); docs/cli.md generated by scripts/gen-cli-docs.ts with a staleness test; docs/{config,analysis,correction,serve,formats}.md; hone init --skills installs the embedded skill into .claude/skills (and .codex/skills) without overwriting unless --force; README documentation section. P8 complete |
| 2026-10-12 | T-901 | #76 | examples/{qa-fn,rag-python,agent-claude-code,mcp-server,harness-ablation} each with hone.config.ts, cases and README; examples/examples.test.ts runs hone ci for every example (rag-python boots app.py on a free port; agent-claude-code replays recorded traces when claude is absent or CI is set) |
| 2026-10-12 | T-902 | #77 | .github/assets/demo.tape + demo.gif (VHS over examples/harness-ablation: ablate, optimize, dashboard) and scripts/demo.sh; README: gif, real captured outputs, current quick start, docs index; docs/README.md index, docs/concepts.md, docs/release.md placeholder; scripts/check-links.ts with a test over every relative Markdown link |
| 2026-10-12 | T-903 | #78 | scripts/build-binaries.ts (six bun --compile targets, SHA256SUMS, --only/--out; darwin-arm64 verified locally: binary runs the CLI), scripts/release-check.ts (semver, tag match, CHANGELOG section, clean tree), .github/workflows/release.yml (check -> binaries matrix -> publish with npm provenance via OIDC -> GitHub Release with assets), CHANGELOG.md, docs/release.md, package scripts build:binaries/release:check/docs:cli/docs:links |
| 2026-10-12 | T-904 | #79 | ruleset verified and recorded (test/fixtures/ruleset.protect-main.json), wiki/projects off, vulnerability alerts + Dependabot security updates on; ci.yml least privilege + concurrency, actions pinned to SHAs in both workflows; dependabot.yml, SECURITY.md, CODEOWNERS, PR and issue templates; scripts/check-hardening.ts with a fixture test; docs/hardening.md with the live check output |
| 2026-10-12 | T-905 | #80 | CHANGELOG 0.1.0, package version 0.1.0, README status line and badge, docs index entries (release, hardening, launch), docs/launch/{hn,x,awesome}.md. BLOCKED on npm credentials: tag not pushed; release.yml will publish once the maintainer configures trusted publishing (docs/release.md) |
| 2026-10-13 | T-1001 | #100 | `hone test` replaces `run` (no alias: nothing was released); `ci` and `report` become `test --ci` and `test --report`; `hone --help` shows the everyday commands only, `hone help all` the rest in three groups with plain summaries; docs/cli.md regrouped; every mention in README, docs, examples, skill and benchmark scripts renamed |
| 2026-10-13 | T-1002 | #101 | `config.sharpen.text` and `config.sharpen.variants` replace the top-level `evolve` and `optimize` keys (same shapes); evolve and optimize read the new block and name it in their errors; harness-ablation example and the RAG benchmark config follow |
| 2026-10-13 | T-1003 | #102 | correct/sharpen.ts: seeded held-out split (in-sample below 12 cases), baseline on dev, gates (cannot measure, nothing to sharpen, nothing to change), diagnosis (offline clusters, named by the model when there is one), variants then rewrites from the best member so far (a rewrite lands on a variant without anyone combining them), sample check before a full run, ledger, confirmation on held-out cases (proven / promising with cases needed / no gain), plain account; `hone sharpen` is the third everyday command |
| 2026-10-13 | T-1007 | #103 | sharpen tries every declared variant on top of a rewrite that became the best member (`variant <name> on rewrite <n>`), so changes that only help together are found, as in the RAG study where a person had combined them; the account names the variant to apply next to the new text |
| 2026-10-13 | T-1004 | #104 | examples/sharpen (toy bot, 18 cases, 0% as written; a real-model run ends PROVEN on 6 held-out cases in 16 s); init writes a commented `sharpen` block and points at `hone test, then hone sharpen`; README leads with the three commands and real output, its config example now runs, and it says who did what in the two studies; skill, correction and concepts docs, CHANGELOG. From the real run: clipped model wording in the account, cluster-aware split with clusters as the unit of the final test, exact sign test as a floor (six of six is the fewest that proves) |
| 2026-10-13 | T-1008 | #107 | `change(name, { why, text, config })` in files under `sharpen/` (registry on globalThis so the bundled CLI and a project's import share it; errors name the file); sharpen searches changes from files, inline variants and model rewrites alike: each alone, then the kind the best member lacks on top of it; ledger gains source, file, why and textFrom; a model's winning rewrite is saved as `<id>-best.ts`; examples/sharpen moves its setting into a change file. Real-model run: PROVEN on 6 held-out cases |
| 2026-10-13 | T-1009 | #108 | every run past the gates writes `.hone/sharpen/<id>-diagnosis.md` (failure modes, three failing dev cases each with input, expected, output and scorer reasons, what may change, a change file to copy; no held-out case) and the account names it; `--budget 0` measures, diagnoses and stops |
| 2026-10-13 | T-1010 | #109 | the skill is a router (`skills/hone/SKILL.md`) with six topic references (setup, cases, sharpening, results, steps, mcp), embedded in the CLI; `hone guide [topic]` prints them; `hone init` installs the skill into `.agents/skills/hone` and `.claude/skills/hone`, registers `bunx hone-eval serve mcp` as `hone` in `.mcp.json` (and `.cursor/mcp.json` when `.cursor/` exists) without touching other servers or an existing entry, and writes `sharpen/README.md`; `--no-agents`; MCP tools `hone_test` (was `hone_run`), `hone_sharpen`, `hone_guide`; a test checks that the skill names only real commands and references |
| 2026-10-13 | T-1011 | #110 | `.hone/sharpen/holdout.json` lists, per split, the different winners its held-out cases have judged; the n-th has to reach alpha / n and the account says so; the same winner again keeps its place (a replication is not another attempt); the fewest units that can prove follow the level (six at 0.05, seven at 0.025) |
| 2026-10-13 | T-1010 follow-up | #111 | docs/benchmarks/agent-writes-changes.md: one real Claude Code session (sonnet, sandboxed, the skill only, no API key for hone) read the diagnosis page, wrote two change files, and hone confirmed the pair as PROVEN on 6 held-out cases in 31 s; the skill now says to delete a change file after applying it |
| 2026-10-13 | T-1101 | #114 | python target: `params` reach the callable as `ctx.params` and, with `env`, are part of the version (two variants of one module no longer share cached outputs); `ctx.from_langchain` and `ctx.from_strands` record messages, tool calls, tool results and usage from what the frameworks return, duck-typed; usage with a model name is priced from the table; `workers` serves calls on threads |
| 2026-10-13 | T-1102 | #116 | `examples/helpdesk-agent`: six tools over in-memory data, the same agent in LangChain 1.4 and Strands 1.60 behind `answer(input, ctx)`, 36 cases (six for each of six house rules) and three trace scorers whose reasons name the broken rule; with the one-line prompt and claude-haiku-5-5 both frameworks pass 33 of 72 trials (verify and lookup 12 of 12, cite and nopolicy 0); 144 agent runs take 90 s and $0.63. Running it showed four python-target faults fixed in #115 (a stale cache after editing the agent, prints taken for answers and framework noise in the output, PYTHONPATH ignored, a timer left behind) |
| 2026-10-13 | T-1106 | #117 | `hone sharpen --no-rewrites` (MCP: `rewrites: false`): the model still names the failure modes but writes no rewrite, so exactly the changes from files and the variants are judged, and the account says so; needed when the agent under test holds the key a proposer other than hone's model should not use |
| 2026-10-13 | T-1106 follow-up | #118 | `hone serve mcp --no-rewrites`: a server whose `hone_sharpen` judges only what the client proposed, whatever arguments the client sends; the operator who starts the server decides, not the agent that talks to it |
| 2026-10-13 | T-1107 | #119 | found in the first real run on a custom agent: the costlier variant won round one, every rewrite was then written on top of it, and the confirmed winner cost 4.7x per case without anyone having measured the prompt alone; now a winning rewrite that sits on a config change is tried once without it, outside the budget, and equal pass rates go to the cheaper and then the smaller change |
| 2026-10-13 | fix | #120 | sharpen and evolve added the price of cached answers to their spend: a rewrite's full run takes its sample from the cache, so each rewrite was counted at up to twice what it cost, `--max-cost` stopped the first real runs after three candidates at a reported 3.9 dollars when 2.9 had been spent, and the ledger's `costUsd` per candidate was too high; a run now carries `spentUsd`, what it ran itself |
| 2026-10-13 | T-1108 | #121 | found in T-1103: two Codex sessions followed "one hypothesis per change" and wrote three or four prompts that each added one rule; a `text` replaces the whole text, so the cycle could not combine them and the sessions had to merge them by hand and spend a second look at the held-out cases. `change(name, { why, add })` is a paragraph for the text as it is; after every change has run alone the additions are stacked, best first, each kept when the stack improves; the default budget covers every change file and its stack; the winner's additions are named and the whole text saved as a change file |
| 2026-10-13 | T-1109 | #122 | found in T-1103: the model's prompt scored 90% on the small model and 92% with the larger one at 4.9x the cost, and one trial of 48 sent the expensive one to the held-out check; now a candidate that costs under nine tenths and is as good by the one-standard-error rule (the case-by-case difference no larger than its standard error: one case) is the winner, the account says what was passed over, and a change that costs clearly more for one case is no gain |
| 2026-10-13 | T-1103 | #123 | `docs/benchmarks/custom-agents.md`: the helpdesk agent in both frameworks, 24 cases to learn from and 12 held out. hone's model: Strands PROVEN 42% to 100% at 1.8x cost, LangChain PROMISING 50% to 83% (its rewrite got the security rule wrong, two held-out cases worse). Codex over the MCP server, judge-only: LangChain PROVEN 42% to 96% at 1.1x, Strands PROMISING 33% to 83% (the prompt made the agent reset a password without the employee ID on a held-out case). Neither session opened the case files. The first runs chose a winner at 4.7x cost and could not combine one-rule prompts: T-1106 to T-1109 and #115, #120 came out of it and were replayed on the same projects. $17.38 on the agent under test, 69% of it on the larger model offered as a variant (T-1110) |
| 2026-10-14 | T-1110 | #124 | 69% of the custom-agent benchmark's spend went to trials on the larger model offered as a variant, because it led after round one and every rewrite was then written on top of it; a config change whose own run cost over 1.1x the baseline's is no longer built on: stacks, pairings and rewrites climb from the best candidate without it, and it goes on top of the final text once, outside the budget and inside `--max-cost` |
| 2026-10-14 | T-1104 | #125 | in a project whose `pyproject.toml` or `requirements*.txt` names `langchain`, `langgraph` or `strands-agents`, `hone init` writes `hone_target.py` (one marked place to return the project's agent; the conversation recorded with `ctx.from_langchain` / `ctx.from_strands`), a `python` target with the system prompt in `params` (the project's `.venv` when there is one) and a `sharpen.text` block that puts a new prompt there; checked for real once: init then `hone test` on LangChain 1.4 passed its sample case for $0.002 |
| 2026-10-14 | fix | #126 | a trial answered from hone's cache carried `flags: cached` into its failure summary, which is what the clustering embeds and the model reads to name failure modes and write rewrites: after a plain `hone test`, `hone sharpen` named the toy's failures "cached-refusal-response" and "stale-cache-template-answer"; the bookkeeping flag is left out of summaries |
| 2026-10-14 | T-1105 | #127 | README rewritten for someone who builds agents: one line of what it does, the three commands with a current real run, what each verdict means and why the cycle says no, the custom-agent path first (one function, cases that read the conversation, the two-framework result with the two regressions the held-out check caught), changes as files with `add`, `text` and `config`, coding agents and the judge-only MCP server, the other targets in one table, three studies each with what it does not show, an honest note next to promptfoo, DeepEval, Inspect and Harbor in place of the feature matrix, and install from source (the npm badge and `bunx hone-eval init` are gone until the package is published); the demo gif now records `hone test` and `hone sharpen` on the toy example; the toy's README carries the same run |
| 2026-10-14 | test | #128 | the nine local servers that tests start bound every interface on a port the kernel chose; twice in a day of full runs a request to 127.0.0.1 on that port reached another process instead (an `HTTP 403: Forbidden` from a server that was not ours, a connection reset); they now bind 127.0.0.1 |
| 2026-10-14 | T-1201 | #130 | the `agent` scorer: a case says what must hold in the conversation (`calls`, `never`, `order`, `args`, `says`, `never_says`, `judge` in words), with no scorer code; the reason names every broken expectation, the model is asked only when the written ones hold, and without a model a rule in words leaves the trial undecided |
| 2026-10-14 | T-1203 | #131 | no new command (the maintainer's call; T-1202 `hone try` dropped): `hone init --cases [--read file] [--count n]` has hone's model read the agent's prompt and code, draft cases in the `agent` grammar into `evals/drafted.yaml` (tagged `drafted`, the rule each checks in `meta.why`, malformed ones and ones naming a tool the code lacks dropped), run them once and report which fail; for real on the helpdesk agent with no cases and no README: 19 cases from the code alone (the documented policies, password resets with a wrong ID, for someone else and a fake "SYSTEM OVERRIDE", unknown employees and policies), 2 failures in both frameworks (no ticket for a software request; a lost device without the security address and the one-hour window), 68 s, $0.26 on the agent; the agent scorer's failure reason now leads with what went wrong |
| 2026-10-14 | T-1204 | #132 | drafting cases outgrew `init` (the maintainer's call): `hone draft [--read file]... [--count n]` does what `hone init --cases` did, unchanged; init loses `--cases`, `--read`, `--count` (no alias); everyday commands are `init`, `draft`, `test`, `sharpen`; README, cli.md and the skill follow |
| 2026-10-14 | fix | #133 | `hone draft` on a real agent (Kkomi, a codebase Q&A agent) wrote cases for multi-turn flows ("approve the plan") that a single-message case cannot test; 5 of 22 drafts were such; the drafting prompt now says each case is the first message of a new conversation |
