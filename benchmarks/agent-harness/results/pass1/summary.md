| target | cases | trials | resolved | 95% CI | every trial | any trial | fail-to-pass share | tokens in / out per trial | est. $ per trial | est. $ per solve | s per trial | turns |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sonnet-plain | 15 | 45 | 14/45 = 31% | [20%, 46%] | 3/15 | 6/15 | 53% | 128k / 3.3k | $0.118 | $0.379 | 29 | 8.6 |
| sonnet-spec | 15 | 45 | 45/45 = 100% | [92%, 100%] | 15/15 | 15/15 | 100% | 83k / 2.4k | $0.089 | $0.089 | 21 | 5.8 |
| sonnet-plain-rules | 15 | 45 | 16/45 = 36% | [23%, 50%] | 5/15 | 6/15 | 58% | 209k / 5.6k | $0.173 | $0.488 | 45 | 11.8 |
| opus-plain | 15 | 45 | 18/45 = 40% | [27%, 55%] | 6/15 | 6/15 | 62% | 291k / 8.9k | $0.520 | $1.301 | 101 | 15.6 |

| target | fix tasks resolved | feat tasks resolved | dev | held-out | ran tests | wrote tests | trials that tried to leave the task | errors |
|---|---|---|---|---|---|---|---|---|
| sonnet-plain | 11/27 = 41% | 3/18 = 17% | 9/24 = 38% | 5/21 = 24% | 87% | 11% | 0 | 0 |
| sonnet-spec | 27/27 = 100% | 18/18 = 100% | 24/24 = 100% | 21/21 = 100% | 69% | 7% | 1 | 0 |
| sonnet-plain-rules | 13/27 = 48% | 3/18 = 17% | 9/24 = 38% | 7/21 = 33% | 100% | 100% | 0 | 0 |
| opus-plain | 15/27 = 56% | 3/18 = 17% | 9/24 = 38% | 9/21 = 43% | 100% | 87% | 2 | 0 |

| target | tasks the title-only statement fully determines | tasks with a test it does not determine |
|---|---|---|
| sonnet-plain | 8/9 = 89% (3 tasks) | 6/36 = 17% (12 tasks) |
| sonnet-spec | 9/9 = 100% (3 tasks) | 36/36 = 100% (12 tasks) |
| sonnet-plain-rules | 9/9 = 100% (3 tasks) | 7/36 = 19% (12 tasks) |
| opus-plain | 9/9 = 100% (3 tasks) | 9/36 = 25% (12 tasks) |

| task | kind | split | sonnet-plain | sonnet-spec | sonnet-plain-rules | opus-plain |
|---|---|---|---|---|---|---|
| branchpoints | feat | heldout | 0/3 (33%) | 3/3 (100%) | 0/3 (50%) | 0/3 (42%) |
| embed-provider | feat | dev | 1/3 (67%) | 3/3 (100%) | 0/3 (50%) | 0/3 (50%) |
| failure-clustering | feat | dev | 2/3 (92%) | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) |
| judge-calibration | feat | dev | 0/3 (54%) | 3/3 (100%) | 0/3 (50%) | 0/3 (50%) |
| rollouts-export | feat | heldout | 0/3 (78%) | 3/3 (100%) | 0/3 (83%) | 0/3 (83%) |
| taxonomy | feat | heldout | 0/3 (50%) | 3/3 (100%) | 0/3 (56%) | 0/3 (50%) |
| anthropic-temperature | fix | dev | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) |
| cache-per-trial | fix | dev | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) |
| calibrate-cases | fix | dev | 0/3 (50%) | 3/3 (100%) | 0/3 (50%) | 0/3 (50%) |
| cluster-induce-errors | fix | heldout | 0/3 (0%) | 3/3 (100%) | 0/3 (0%) | 3/3 (100%) |
| evolve-max-tokens | fix | heldout | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) |
| fork-first-user | fix | heldout | 2/3 (67%) | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) |
| matrix-errors | fix | dev | 0/3 (0%) | 3/3 (100%) | 0/3 (0%) | 0/3 (0%) |
| matrix-undecided | fix | heldout | 0/3 (0%) | 3/3 (100%) | 1/3 (33%) | 0/3 (0%) |
| synth-messages | fix | dev | 0/3 (0%) | 3/3 (100%) | 0/3 (0%) | 0/3 (0%) |

| comparison | scope | metric | cases | A | B | difference | 95% CI | p | cases A better / worse | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| sonnet-spec vs sonnet-plain | all | resolved | 15 | 100% | 31% | +68.9 pts | [45.3, 92.5] | 0.000 | 12 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | all | fail-to-pass share | 15 | 100% | 53% | +47.3 pts | [26.0, 68.6] | 0.000 | 12 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | held-out | resolved | 7 | 100% | 24% | +76.2 pts | [37.5, 114.8] | 0.003 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | held-out | fail-to-pass share | 7 | 100% | 47% | +53.2 pts | [17.8, 88.5] | 0.010 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | dev | resolved | 8 | 100% | 38% | +62.5 pts | [24.7, 100.3] | 0.006 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | dev | fail-to-pass share | 8 | 100% | 58% | +42.2 pts | [8.2, 76.1] | 0.022 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | all | resolved | 15 | 100% | 36% | +64.4 pts | [37.9, 91.0] | 0.000 | 10 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | all | fail-to-pass share | 15 | 100% | 58% | +41.9 pts | [20.7, 63.0] | 0.001 | 10 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | held-out | resolved | 7 | 100% | 33% | +66.7 pts | [23.1, 110.3] | 0.010 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | held-out | fail-to-pass share | 7 | 100% | 60% | +39.7 pts | [5.5, 73.8] | 0.029 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | dev | resolved | 8 | 100% | 38% | +62.5 pts | [19.2, 105.8] | 0.011 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | dev | fail-to-pass share | 8 | 100% | 56% | +43.8 pts | [8.9, 78.6] | 0.021 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | all | resolved | 15 | 100% | 40% | +60.0 pts | [31.9, 88.1] | 0.000 | 9 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | all | fail-to-pass share | 15 | 100% | 62% | +38.3 pts | [16.6, 60.1] | 0.002 | 9 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | held-out | resolved | 7 | 100% | 43% | +57.1 pts | [7.7, 106.6] | 0.030 | 4 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | held-out | fail-to-pass share | 7 | 100% | 68% | +32.1 pts | [-3.6, 67.9] | 0.070 | 4 / 0 | no measurable difference |
| sonnet-spec vs opus-plain | dev | resolved | 8 | 100% | 38% | +62.5 pts | [19.2, 105.8] | 0.011 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | dev | fail-to-pass share | 8 | 100% | 56% | +43.8 pts | [8.9, 78.6] | 0.021 | 5 / 0 | sonnet-spec better |
| sonnet-plain-rules vs sonnet-plain | all | resolved | 15 | 36% | 31% | +4.4 pts | [-5.1, 14.0] | 0.334 | 3 / 1 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | all | fail-to-pass share | 15 | 58% | 53% | +5.5 pts | [-1.9, 12.8] | 0.134 | 6 / 2 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | held-out | resolved | 7 | 33% | 24% | +9.5 pts | [-5.5, 24.6] | 0.172 | 2 / 0 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | held-out | fail-to-pass share | 7 | 60% | 47% | +13.5 pts | [-0.1, 27.0] | 0.051 | 5 / 0 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | dev | resolved | 8 | 38% | 38% | +0.0 pts | [-14.9, 14.9] | 1.000 | 1 / 1 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | dev | fail-to-pass share | 8 | 56% | 58% | -1.6 pts | [-7.4, 4.3] | 0.549 | 1 / 2 | no measurable difference |
| sonnet-plain-rules vs opus-plain | all | resolved | 15 | 36% | 40% | -4.4 pts | [-19.8, 10.9] | 0.546 | 1 / 1 | no measurable difference |
| sonnet-plain-rules vs opus-plain | all | fail-to-pass share | 15 | 58% | 62% | -3.5 pts | [-19.1, 12.0] | 0.635 | 3 / 1 | no measurable difference |
| sonnet-plain-rules vs opus-plain | held-out | resolved | 7 | 33% | 43% | -9.5 pts | [-48.2, 29.1] | 0.569 | 1 / 1 | no measurable difference |
| sonnet-plain-rules vs opus-plain | held-out | fail-to-pass share | 7 | 60% | 68% | -7.5 pts | [-46.8, 31.7] | 0.655 | 3 / 1 | no measurable difference |
| sonnet-plain-rules vs opus-plain | dev | resolved | 8 | 38% | 38% | +0.0 pts | [0.0, 0.0] | 1.000 | 0 / 0 | no measurable difference |
| sonnet-plain-rules vs opus-plain | dev | fail-to-pass share | 8 | 56% | 56% | +0.0 pts | [0.0, 0.0] | 1.000 | 0 / 0 | no measurable difference |
| opus-plain vs sonnet-plain | all | resolved | 15 | 40% | 31% | +8.9 pts | [-7.4, 25.2] | 0.262 | 3 / 1 | no measurable difference |
| opus-plain vs sonnet-plain | all | fail-to-pass share | 15 | 62% | 53% | +9.0 pts | [-6.1, 24.1] | 0.222 | 5 / 2 | no measurable difference |
| opus-plain vs sonnet-plain | held-out | resolved | 7 | 43% | 24% | +19.0 pts | [-15.9, 54.0] | 0.231 | 2 / 0 | no measurable difference |
| opus-plain vs sonnet-plain | held-out | fail-to-pass share | 7 | 68% | 47% | +21.0 pts | [-13.0, 55.0] | 0.181 | 4 / 0 | no measurable difference |
| opus-plain vs sonnet-plain | dev | resolved | 8 | 38% | 38% | +0.0 pts | [-14.9, 14.9] | 1.000 | 1 / 1 | no measurable difference |
| opus-plain vs sonnet-plain | dev | fail-to-pass share | 8 | 56% | 58% | -1.6 pts | [-7.4, 4.3] | 0.549 | 1 / 2 | no measurable difference |
