# Benchmark study: does hone improve a real RAG system?

Date: 2026-10-12. Status: **complete except the confirmatory 3-trial comparison**, which hit the Anthropic account's monthly usage limit after about 1,000 generations (access returns 2026-11-01 unless the limit is raised). Measurement, judge calibration, failure taxonomy, the bandit comparison of the hand-made candidates, automatic prompt evolution and the ablation are done.

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

### 1. Measure: baseline (prompt v1, top_k 5), 43 cases x 2 trials, `hone run --no-cache`

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

## Blocked: the confirmatory comparison

`confirm/hone.config.ts` runs baseline, v3-k30 and the evolved prompt in one run with 3 trials each (387 generations) so the paired test has the power the single-trial bandit lacked (`hone power` says about 109 paired cases, or more trials per case, for the +7-point effect). It started at 23:20 KST and every generation failed with Anthropic's "You have reached your specified API usage limits" (log kept as `logs/confirm-failed-quota.log`). It needs the account limit raised, then `benchmarks/rag-policy-qa/confirm.sh`.

## What this study found in hone itself (all fixed and merged the same day)

- `hone evolve` discarded every proposal as "reply not JSON": the reflection call used the provider's default 1,024 output tokens and a rewritten Korean prompt is longer than that. It now asks for enough tokens.
- A run whose generations all fail shows up in `hone matrix` as pass@1 0.09 with no hint that 387 of 387 trials errored; an `errors` column was added so a dead API key or a quota limit cannot pass for a bad system.

- `hone calibrate` handed scorers a minimal case without `expected`, so every gold-set scorer errored into "undecided" and detections read 0/12; it also sampled the first n passing trials in store order (all refusals here). Now it loads the config's cases and samples with a seeded shuffle.
- The content-addressed cache keyed target outputs on (input, version) only, so trial 1 silently reused trial 0's output; n trials measured no variance. The key now includes the trial index.
- No way to write a scorer inline; the project's scoring rule could not be expressed with the built-in kinds. Added `{ name: "fn", score: (ctx) => ... }` and exported the Jev client for config authors.
- The python bridge ran with `-I`, so `module: "x"` in the working directory was not found.
- Anthropic's Claude 5 models reject `temperature`; the provider no longer sends it.

## Cost and time

Generation: about 1,000 answers through Anthropic across baseline, optimize, evolve (3 candidates: 3 x (30 + 86) + 86) and ablate (172), not metered by hone because the service's own client made the calls; roughly 6M input tokens, which is what exhausted the account's monthly limit. Judge: Jev, about $0.40 for the whole study. Wall clock: baseline 7 min, optimize 11 min, evolve 48 min, ablate 13 min, calibrate and taxonomy under 2 min each.
