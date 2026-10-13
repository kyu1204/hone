# Benchmark study: does hone improve a real RAG system?

Date: 2026-10-12 to 2026-10-13. Status: **complete.** Result in one line: the prompt hone evolved automatically from the failure clusters beats the baseline on usefulness by +8.5 points (p = 0.047) with zero hallucinations, confirmed with 3 trials per case; the authors' hand-tuned best setting gains +7.8 points (p = 0.049) but introduces hallucinations, and the two are not distinguishable from each other.

## What was evaluated

[`kyu1204/rag_qa_eval`](https://github.com/kyu1204/rag_qa_eval): a citation RAG QA service over the Korean government booklet "2026년 하반기부터 이렇게 달라집니다" (428 pages, 693 chunks), with its own 43-question gold set (20 quantitative, 13 qualitative with atomised facts, 10 unanswerable/trap) and a 0/1/2 scoring rule (2 useful, 1 safe but incomplete or a wrongful refusal, 0 hallucination) judged with Jev. Its authors had already improved it by hand from 81.4% to 89.9% useful (prompt v3 + top_k 30 + medium reasoning), so there is a human reference for what "improvement" looks like.

Everything hone needed lives in [`benchmarks/rag-policy-qa/`](../../benchmarks/rag-policy-qa/): `hone.config.ts` (a `python` target that runs the service's own `app.rag` in-process, and an inline `fn` scorer that is a line-by-line port of the project's `eval/scoring.py` + `eval/judge.py`, same Jev templates and thresholds), `cases.json` (the 43 approved gold items), `study.sh` (the exact command sequence), `results/` (every analysis file and all trials exported as JSONL).

### Deviations from the original stack (important)

The project's Elice API key had expired, so the embedder and the generator were substituted and the corpus re-ingested into a separate database (no code in the project was changed):

| component | original | this study |
|---|---|---|
| embeddings | text-embedding-3-small via Elice (1536d) | bge-m3 via local Ollama (1024d) |
| generation | GPT-5.6 Luna via Elice | Claude Sonnet 5.5 via Anthropic's OpenAI-compatible endpoint, reasoning medium |
| judge | Jev jev-1.13.0 | Jev (same templates, judge-ko-v2 support wording, 2 repeats averaged) |

So absolute numbers are not comparable with the project's README; the before/after inside this study is. The baseline landed at 79.1% useful, close to the project's 81.4%, and failed in the same place (qualitative questions, retrieval coverage), which suggests the substitution kept the system's character.

## Results

### 1. Measure: baseline (prompt v1, top_k 5), 43 cases x 2 trials, `hone test --no-cache`

| group | n | useful (2) | safe (>0) | 2/1/0 |
|---|---|---|---|---|
| quantitative | 40 | 100.0% | 100.0% | 40/0/0 |
| qualitative | 26 | 38.5% | 92.3% | 10/14/2 |
| unanswerable/trap | 20 | 90.0% | 100.0% | 18/2/0 |
| **all** | 86 | **79.1%** | 97.7% | 68/16/2 |

Failure causes (16+2 non-useful trials): retrieval failure 12, wrongful refusal 2, hallucination 2, generation omission 2. 5.6 s and about 5,600 tokens per answer; Jev cost $0.03 for the run. The two trials agreed on every case (pairing later reduced variance by 77%), so the system is close to deterministic at this setting.

### 2. Is the judge trustworthy? `hone calibrate --scorer grade --domain rag --n 12`

| injected fault | detected | 95% CI |
|---|---|---|
| unsupported-claim (an extra sentence no source supports) | 11/12 = 92% | [65%, 99%] |
| wrong-citation (a [n] marker pointed at another chunk) | 0/11 = 0% | [0%, 26%] |
| false alarms on clean answers | 0/12 | |

The ported judge catches fabricated sentences (the per-sentence "support" check works) and never flags clean answers, but it is blind to a wrong citation marker in the text: the scoring rule checks the service's structured `citations` field, not the `[n]` markers the reader sees. That is a real blind spot of the original harness, found in minutes.

### 3. Localize: `hone cluster --induce` (Claude names the modes, Jev classifies all 18 failures)

| code | count | definition |
|---|---|---|
| retrieval-coverage-gap | 8 | The retrieval step returns sources that cover only part of what the question needs (graded as a search failure with partial coverage, e.g. 2 |
| low-coverage-retrieval-answer | 6 | The assistant gives a detailed, confidently cited answer even though the grader marked retrieval as failed with low source coverage (e.g. 18 |
| unsupported-policy-claims | 2 | The assistant answers questions about Korean government policy changes (effective dates, eligibility, benefit amounts, agencies) with specif |
| other | 2 | No listed failure mode fits. |

The taxonomy says what the per-case table only hinted: the dominant failure is retrieval covering part of a multi-fact question, and the generator then answering confidently from partial sources.

### 4. Propose and compare: `hone optimize --budget 60 --batch 10` over the authors' hand-found candidates

Arms: baseline (v1, k5), prompt-v3, k30, v3-k30. Thompson sampling spent the 60 trials, then hone topped up the baseline and the leader to full coverage (58 extra trials) for the paired verdict.

| arm | trials | useful | 95% CI | P(best) |
|---|---|---|---|---|
| v3-k30 | 43 | 37/43 = 86% | [73%, 93%] | 65% |
| baseline | 43 | 34/43 = 79% | [65%, 89%] | 16% |
| k30 | 17 | 13/17 = 76% | [53%, 90%] | 11% |
| prompt-v3 | 15 | 11/15 = 73% | [48%, 89%] | 8% |

Paired comparison on the 43 shared cases (`hone compare --run <baseline> --run <v3-k30> rag`): v3-k30 86.0% vs baseline 79.1%, difference +7.0 pts, CI95% [-1.0, +14.9], paired t p = 0.083, exact McNemar p = 0.25 (3 cases improved, 0 regressed). **Verdict: no measurable effect at alpha 0.05.** On mean 0/1/2 score the gap is only +1.2 pts (p = 0.66) because v3-k30 traded two wrongful refusals for two hallucinations (safety 100% to 95.3%).

Per group, v3-k30: quantitative 100%, qualitative 53.8% (from 46.2%), unanswerable/trap 100% (from 80%).

### Reading

- The direction matches the authors' hand result (+7 here, +8.5 there), and the bandit found the same winner they did in 60 trials instead of 5 x 129. But with 43 cases and one trial per arm the effect is not significant, and `hone power --effect 0.27` (the observed paired effect: +7.0 pts over a paired difference SD of 0.26) says about 109 paired cases are needed to call it at 80% power. hone said "no measurable effect" instead of "improved by 7 points"; that is the point of the tool.
- The improvement is all on the "useful" axis; on the project's safety axis v3-k30 is worse. A one-number summary would have hidden that.

### 5. Propose automatically: `hone evolve --budget 3 --minibatch 6` (Claude rewrites the v1 prompt from the failure summaries)

Each candidate: one reflection call with the parent text and six failure summaries, a minibatch of the parent's 9 failed cases plus 6 passing ones (rejected if worse there), then the full 43 x 2 run. All three proposals passed the minibatch and were run in full:

| candidate | useful (43 x 2) | 95% CI | minibatch (cand vs parent) | Pareto | what the model changed |
|---|---|---|---|---|---|
| baseline (v1) | 79.1% | [69%, 86%] | | yes | |
| cand-1 | 81.4% | [72%, 88%] | 53% vs 40% |  | 오거절을 줄이도록 NO_ANSWER 조건을 '관련 내용이 전혀 없을 때'로 좁히고, 커버리지 실패를 줄이도록 모든 출처를 훑어 관련 제도와 핵심 정보를 빠짐없이 담게 했다. |
| cand-2 | 83.7% | [75%, 90%] | 53% vs 47% | yes | 제도 누락(커버리지 부족)을 막기 위해 한 출처 내 복수 제도 확인, 부분 일치 제도 포함, 길어질 때 제도별 설명 압축·완결 출력을 추가하고, 환각을 막기 위해 모든 문장 출처 표기와 추측·메타 설명·임의 구분 금지를 명시했다. |
| cand-3 | 82.6% | [73%, 89%] | 50% vs 40% | yes | 답변이 일부 제도만 다루어 커버리지가 낮았고 한 건은 오거절이었으므로, 출처 전체를 훑어 모두 나열하고 항목당 분량을 제한하며, 부분 답변이 가능하면 거절하지 말고 NO_ANSWER는 관련 내용이 전혀 없을 때만 쓰도록 했다. |

Best candidate cand-2 ([`results/evolved-prompt-cand-2.txt`](../../benchmarks/rag-policy-qa/results/evolved-prompt-cand-2.txt)): +4.7 pts over the baseline on the same cases, **verdict: no measurable effect**. The rewrite is readable and targeted: it tells the model to scan every source for multiple policies, list all of them rather than stop after one or two, keep per-policy detail short rather than drop policies, cite every sentence, and refuse only when nothing is relevant. That is exactly the failure taxonomy (retrieval covers part of a multi-fact question, the generator stops early) turned into instructions; the authors' own v2/v3 prompts made the same kind of change by hand.

### 6. What is load-bearing: `hone ablate` (remove the citation rule from the v1 prompt)

| ablation | useful | delta vs baseline | CI95 | p | verdict |
|---|---|---|---|---|---|
| no-citation-rule | 34% | -44 pts | [-60, -28] | 1.3e-6 | component helps |

Without rule 2 ("cite [n] after every factual sentence") answers lose their structured citations and the quantitative questions drop from 100% useful to "cited wrongly" (score 1). The one component we removed is the one the scorer leans on hardest; a significant result in one run of 86 + 86 trials.

## 7. Confirm: one run, 43 cases x 3 trials x 3 targets (`confirm/hone.config.ts`, 387 generations)

The single-trial bandit could not call a +7-point effect; `hone power` asked for more pairs or more trials. With 3 trials per case and all three systems in one run the comparisons are paired on the same 43 cases:

| target | useful | safe | 2/1/0 | tokens/answer | s/answer |
|---|---|---|---|---|---|
| baseline (v1, k5) | 79.8% | 100% | 103/26/0 | 5.5k | 5.3 |
| v3-k30 (authors' best, by hand) | 87.6% | 97.7% | 113/13/3 | 26.4k | 6.7 |
| evolved (hone, cand-2 + k30) | **88.4%** | **100%** | 114/15/0 | 27.9k | 11.4 |

| paired comparison (`hone compare`) | useful (pass rate) | mean 0/1/2 score |
|---|---|---|
| v3-k30 vs baseline | +7.8 pts, CI [0.1, 15.5], p = 0.049, **better** | +2.7 pts, p = 0.16, no significant difference |
| evolved vs baseline | +8.5 pts, CI [0.1, 16.9], p = 0.047, **better** | +4.3 pts, CI [0.1, 8.5], p = 0.047, **better** |
| evolved vs v3-k30 | +0.8 pts, p = 0.32, no significant difference | +1.6 pts, p = 0.10, no significant difference |

Per group the evolved prompt takes qualitative questions from 41.0% to 61.5% useful and unanswerable/trap questions from 90% to 100%, and keeps quantitative questions at 100%. The authors' v3-k30 reaches the same usefulness but pays with three hallucinations (two in the bandit stage, three here), which is why it wins only on the usefulness axis; the evolved prompt wins on both because its rewrite also tightened the citation and no-speculation rules.

What this costs: the evolved answers use five times the tokens of the baseline and take twice as long. hone reports that next to the pass rate, so the trade is visible.

### Reading, revised

- The loop measured, localized (retrieval coverage on multi-fact questions), proposed (three rewrites from the taxonomy), verified on a minibatch, and confirmed with a paired test. The whole thing took about 90 minutes of machine time and roughly 1,400 generations.
- The automatic rewrite matched the authors' week of hand tuning on usefulness and beat it on safety. It is not magic: it encoded the same diagnosis they had reached, but it did so from the failure clusters without a human reading transcripts.
- Two trials were not enough to see any of this ("no measurable effect" every time); three were. The tool's refusal to call the effect early was correct, and the power estimate told us what to do about it.

## What this study found in hone itself (all fixed and merged the same day)

- `hone evolve` discarded every proposal as "reply not JSON": the reflection call used the provider's default 1,024 output tokens and a rewritten Korean prompt is longer than that. It now asks for enough tokens.
- A run whose generations all fail shows up in `hone matrix` as pass@1 0.09 with no hint that 387 of 387 trials errored; an `errors` column was added so a dead API key or a quota limit cannot pass for a bad system.

- `hone calibrate` handed scorers a minimal case without `expected`, so every gold-set scorer errored into "undecided" and detections read 0/12; it also sampled the first n passing trials in store order (all refusals here). Now it loads the config's cases and samples with a seeded shuffle.
- The content-addressed cache keyed target outputs on (input, version) only, so trial 1 silently reused trial 0's output; n trials measured no variance. The key now includes the trial index.
- No way to write a scorer inline; the project's scoring rule could not be expressed with the built-in kinds. Added `{ name: "fn", score: (ctx) => ... }` and exported the Jev client for config authors.
- The python bridge ran with `-I`, so `module: "x"` in the working directory was not found.
- Anthropic's Claude 5 models reject `temperature`; the provider no longer sends it.

## Cost and time

Generation: about 1,400 answers through Anthropic across baseline, optimize, evolve (3 candidates: 3 x (30 + 86) + 86), ablate (172) and the confirmation (387), not metered by hone because the service's own client made the calls; roughly 12M input tokens, which hit the account's monthly limit once (raised, then rerun). Judge: Jev, about $0.90 for the whole study. Wall clock: baseline 7 min, optimize 11 min, evolve 48 min, ablate 13 min, confirmation 46 min, calibrate and taxonomy under 2 min each.
