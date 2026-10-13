| target | cases | trials | resolved | 95% CI | every trial | any trial | fail-to-pass share | tokens in / out per trial | est. $ per trial | est. $ per solve | s per trial | turns |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sonnet-spec | 15 | 45 | 45/45 = 100% | [92%, 100%] | 15/15 | 15/15 | 100% | 73k / 2.4k | $0.082 | $0.082 | 22 | 5.9 |
| sonnet-plain | 15 | 45 | 11/45 = 24% | [14%, 39%] | 3/15 | 4/15 | 47% | 117k / 3.2k | $0.107 | $0.439 | 29 | 8.4 |
| sonnet-plain-rules | 15 | 45 | 14/45 = 31% | [20%, 46%] | 4/15 | 5/15 | 51% | 195k / 5.6k | $0.168 | $0.539 | 45 | 11.8 |
| opus-plain | 15 | 45 | 22/45 = 49% | [35%, 63%] | 6/15 | 8/15 | 68% | 282k / 8.9k | $0.518 | $1.059 | 99 | 15.6 |

| target | fix tasks resolved | feat tasks resolved | dev | held-out | ran tests | wrote tests | trials that tried to leave the task | errors |
|---|---|---|---|---|---|---|---|---|
| sonnet-spec | 27/27 = 100% | 18/18 = 100% | 24/24 = 100% | 21/21 = 100% | 62% | 7% | 2 | 0 |
| sonnet-plain | 9/27 = 33% | 2/18 = 11% | 8/24 = 33% | 3/21 = 14% | 82% | 4% | 0 | 0 |
| sonnet-plain-rules | 11/27 = 41% | 3/18 = 17% | 9/24 = 38% | 5/21 = 24% | 100% | 100% | 0 | 0 |
| opus-plain | 16/27 = 59% | 6/18 = 33% | 14/24 = 58% | 8/21 = 38% | 100% | 78% | 0 | 0 |

| target | tasks the title-only statement fully determines | tasks with a test it does not determine |
|---|---|---|
| sonnet-spec | 9/9 = 100% (3 tasks) | 36/36 = 100% (12 tasks) |
| sonnet-plain | 6/9 = 67% (3 tasks) | 5/36 = 14% (12 tasks) |
| sonnet-plain-rules | 8/9 = 89% (3 tasks) | 6/36 = 17% (12 tasks) |
| opus-plain | 9/9 = 100% (3 tasks) | 13/36 = 36% (12 tasks) |

| task | kind | split | sonnet-spec | sonnet-plain | sonnet-plain-rules | opus-plain |
|---|---|---|---|---|---|---|
| branchpoints | feat | heldout | 3/3 (100%) | 0/3 (42%) | 0/3 (25%) | 0/3 (50%) |
| embed-provider | feat | dev | 3/3 (100%) | 0/3 (50%) | 0/3 (50%) | 3/3 (100%) |
| failure-clustering | feat | dev | 3/3 (100%) | 2/3 (92%) | 3/3 (100%) | 3/3 (100%) |
| judge-calibration | feat | dev | 3/3 (100%) | 0/3 (50%) | 0/3 (50%) | 0/3 (50%) |
| rollouts-export | feat | heldout | 3/3 (100%) | 0/3 (78%) | 0/3 (72%) | 0/3 (83%) |
| taxonomy | feat | heldout | 3/3 (100%) | 0/3 (44%) | 0/3 (56%) | 0/3 (50%) |
| anthropic-temperature | fix | dev | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) |
| cache-per-trial | fix | dev | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) |
| calibrate-cases | fix | dev | 3/3 (100%) | 0/3 (50%) | 0/3 (50%) | 0/3 (50%) |
| cluster-induce-errors | fix | heldout | 3/3 (100%) | 0/3 (0%) | 0/3 (0%) | 2/3 (67%) |
| evolve-max-tokens | fix | heldout | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) |
| fork-first-user | fix | heldout | 3/3 (100%) | 0/3 (0%) | 2/3 (67%) | 3/3 (100%) |
| matrix-errors | fix | dev | 3/3 (100%) | 0/3 (0%) | 0/3 (0%) | 2/3 (67%) |
| matrix-undecided | fix | heldout | 3/3 (100%) | 0/3 (0%) | 0/3 (0%) | 0/3 (0%) |
| synth-messages | fix | dev | 3/3 (100%) | 0/3 (0%) | 0/3 (0%) | 0/3 (0%) |

| comparison | scope | metric | cases | A | B | difference | 95% CI | p | cases A better / worse | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| sonnet-spec vs sonnet-plain | all | resolved | 15 | 100% | 24% | +75.6 pts | [51.9, 99.2] | 0.000 | 12 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | all | fail-to-pass share | 15 | 100% | 47% | +53.0 pts | [30.8, 75.2] | 0.000 | 12 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | held-out | resolved | 7 | 100% | 14% | +85.7 pts | [50.8, 120.7] | 0.001 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | held-out | fail-to-pass share | 7 | 100% | 38% | +62.3 pts | [24.9, 99.7] | 0.007 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | dev | resolved | 8 | 100% | 33% | +66.7 pts | [27.3, 106.1] | 0.005 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | dev | fail-to-pass share | 8 | 100% | 55% | +44.8 pts | [10.9, 78.7] | 0.017 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | all | resolved | 15 | 100% | 31% | +68.9 pts | [43.3, 94.5] | 0.000 | 11 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | all | fail-to-pass share | 15 | 100% | 51% | +48.7 pts | [27.1, 70.4] | 0.000 | 11 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | held-out | resolved | 7 | 100% | 24% | +76.2 pts | [37.5, 114.8] | 0.003 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | held-out | fail-to-pass share | 7 | 100% | 46% | +54.4 pts | [19.0, 89.8] | 0.009 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | dev | resolved | 8 | 100% | 38% | +62.5 pts | [19.2, 105.8] | 0.011 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | dev | fail-to-pass share | 8 | 100% | 56% | +43.8 pts | [8.9, 78.6] | 0.021 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | all | resolved | 15 | 100% | 49% | +51.1 pts | [24.2, 78.0] | 0.001 | 9 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | all | fail-to-pass share | 15 | 100% | 68% | +32.2 pts | [13.0, 51.5] | 0.003 | 9 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | held-out | resolved | 7 | 100% | 38% | +61.9 pts | [16.8, 107.0] | 0.015 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | held-out | fail-to-pass share | 7 | 100% | 64% | +35.7 pts | [3.1, 68.3] | 0.037 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | dev | resolved | 8 | 100% | 58% | +41.7 pts | [0.2, 83.1] | 0.049 | 4 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | dev | fail-to-pass share | 8 | 100% | 71% | +29.2 pts | [-1.3, 59.6] | 0.058 | 4 / 0 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | all | resolved | 15 | 31% | 24% | +6.7 pts | [-3.7, 17.0] | 0.189 | 2 / 0 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | all | fail-to-pass share | 15 | 51% | 47% | +4.3 pts | [-5.9, 14.4] | 0.382 | 3 / 2 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | held-out | resolved | 7 | 24% | 14% | +9.5 pts | [-13.8, 32.8] | 0.356 | 1 / 0 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | held-out | fail-to-pass share | 7 | 46% | 38% | +7.9 pts | [-17.2, 33.1] | 0.469 | 2 / 2 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | dev | resolved | 8 | 38% | 33% | +4.2 pts | [-5.7, 14.0] | 0.351 | 1 / 0 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | dev | fail-to-pass share | 8 | 56% | 55% | +1.0 pts | [-1.4, 3.5] | 0.351 | 1 / 0 | no measurable difference |
| sonnet-plain-rules vs opus-plain | all | resolved | 15 | 31% | 49% | -17.8 pts | [-36.1, 0.5] | 0.056 | 0 / 4 | no measurable difference |
| sonnet-plain-rules vs opus-plain | all | fail-to-pass share | 15 | 51% | 68% | -16.5 pts | [-30.7, -2.3] | 0.026 | 1 / 6 | opus-plain better |
| sonnet-plain-rules vs opus-plain | held-out | resolved | 7 | 24% | 38% | -14.3 pts | [-38.5, 10.0] | 0.200 | 0 / 2 | no measurable difference |
| sonnet-plain-rules vs opus-plain | held-out | fail-to-pass share | 7 | 46% | 64% | -18.7 pts | [-42.2, 4.9] | 0.101 | 1 / 4 | no measurable difference |
| sonnet-plain-rules vs opus-plain | dev | resolved | 8 | 38% | 58% | -20.8 pts | [-53.9, 12.3] | 0.180 | 0 / 2 | no measurable difference |
| sonnet-plain-rules vs opus-plain | dev | fail-to-pass share | 8 | 56% | 71% | -14.6 pts | [-37.5, 8.3] | 0.175 | 0 / 2 | no measurable difference |
| opus-plain vs sonnet-plain | all | resolved | 15 | 49% | 24% | +24.4 pts | [3.0, 45.9] | 0.028 | 5 / 0 | opus-plain better |
| opus-plain vs sonnet-plain | all | fail-to-pass share | 15 | 68% | 47% | +20.7 pts | [2.5, 38.9] | 0.028 | 8 / 0 | opus-plain better |
| opus-plain vs sonnet-plain | held-out | resolved | 7 | 38% | 14% | +23.8 pts | [-14.8, 62.5] | 0.182 | 2 / 0 | no measurable difference |
| opus-plain vs sonnet-plain | held-out | fail-to-pass share | 7 | 64% | 38% | +26.6 pts | [-10.5, 63.6] | 0.130 | 5 / 0 | no measurable difference |
| opus-plain vs sonnet-plain | dev | resolved | 8 | 58% | 33% | +25.0 pts | [-7.5, 57.5] | 0.111 | 3 / 0 | no measurable difference |
| opus-plain vs sonnet-plain | dev | fail-to-pass share | 8 | 71% | 55% | +15.6 pts | [-6.9, 38.1] | 0.144 | 3 / 0 | no measurable difference |
