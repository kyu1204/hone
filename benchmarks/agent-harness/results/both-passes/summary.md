| target | cases | trials | resolved | 95% CI | every trial | any trial | fail-to-pass share | tokens in / out per trial | est. $ per trial | est. $ per solve | s per trial | turns |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sonnet-plain | 15 | 90 | 25/90 = 28% | [20%, 38%] | 3/15 | 6/15 | 50% | 122k / 3.3k | $0.113 | $0.405 | 29 | 8.5 |
| sonnet-spec | 15 | 90 | 90/90 = 100% | [96%, 100%] | 15/15 | 15/15 | 100% | 78k / 2.4k | $0.085 | $0.085 | 21 | 5.8 |
| sonnet-plain-rules | 15 | 90 | 30/90 = 33% | [24%, 44%] | 4/15 | 6/15 | 55% | 202k / 5.6k | $0.171 | $0.512 | 45 | 11.8 |
| opus-plain | 15 | 90 | 40/90 = 44% | [35%, 55%] | 5/15 | 8/15 | 65% | 287k / 8.9k | $0.519 | $1.168 | 100 | 15.6 |

| target | fix tasks resolved | feat tasks resolved | dev | held-out | ran tests | wrote tests | trials that tried to leave the task | errors |
|---|---|---|---|---|---|---|---|---|
| sonnet-plain | 20/54 = 37% | 5/36 = 14% | 17/48 = 35% | 8/42 = 19% | 84% | 8% | 0 | 0 |
| sonnet-spec | 54/54 = 100% | 36/36 = 100% | 48/48 = 100% | 42/42 = 100% | 66% | 7% | 3 | 0 |
| sonnet-plain-rules | 24/54 = 44% | 6/36 = 17% | 18/48 = 38% | 12/42 = 29% | 100% | 100% | 0 | 0 |
| opus-plain | 31/54 = 57% | 9/36 = 25% | 23/48 = 48% | 17/42 = 40% | 100% | 82% | 2 | 0 |

| target | tasks the title-only statement fully determines | tasks with a test it does not determine |
|---|---|---|
| sonnet-plain | 14/18 = 78% (3 tasks) | 11/72 = 15% (12 tasks) |
| sonnet-spec | 18/18 = 100% (3 tasks) | 72/72 = 100% (12 tasks) |
| sonnet-plain-rules | 17/18 = 94% (3 tasks) | 13/72 = 18% (12 tasks) |
| opus-plain | 18/18 = 100% (3 tasks) | 22/72 = 31% (12 tasks) |

| task | kind | split | sonnet-plain | sonnet-spec | sonnet-plain-rules | opus-plain |
|---|---|---|---|---|---|---|
| branchpoints | feat | heldout | 0/6 (38%) | 6/6 (100%) | 0/6 (38%) | 0/6 (46%) |
| embed-provider | feat | dev | 1/6 (58%) | 6/6 (100%) | 0/6 (50%) | 3/6 (75%) |
| failure-clustering | feat | dev | 4/6 (92%) | 6/6 (100%) | 6/6 (100%) | 6/6 (100%) |
| judge-calibration | feat | dev | 0/6 (52%) | 6/6 (100%) | 0/6 (50%) | 0/6 (50%) |
| rollouts-export | feat | heldout | 0/6 (78%) | 6/6 (100%) | 0/6 (78%) | 0/6 (83%) |
| taxonomy | feat | heldout | 0/6 (47%) | 6/6 (100%) | 0/6 (56%) | 0/6 (50%) |
| anthropic-temperature | fix | dev | 6/6 (100%) | 6/6 (100%) | 6/6 (100%) | 6/6 (100%) |
| cache-per-trial | fix | dev | 6/6 (100%) | 6/6 (100%) | 6/6 (100%) | 6/6 (100%) |
| calibrate-cases | fix | dev | 0/6 (50%) | 6/6 (100%) | 0/6 (50%) | 0/6 (50%) |
| cluster-induce-errors | fix | heldout | 0/6 (0%) | 6/6 (100%) | 0/6 (0%) | 5/6 (83%) |
| evolve-max-tokens | fix | heldout | 6/6 (100%) | 6/6 (100%) | 6/6 (100%) | 6/6 (100%) |
| fork-first-user | fix | heldout | 2/6 (33%) | 6/6 (100%) | 5/6 (83%) | 6/6 (100%) |
| matrix-errors | fix | dev | 0/6 (0%) | 6/6 (100%) | 0/6 (0%) | 2/6 (33%) |
| matrix-undecided | fix | heldout | 0/6 (0%) | 6/6 (100%) | 1/6 (17%) | 0/6 (0%) |
| synth-messages | fix | dev | 0/6 (0%) | 6/6 (100%) | 0/6 (0%) | 0/6 (0%) |

| comparison | scope | metric | cases | A | B | difference | 95% CI | p | cases A better / worse | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| sonnet-spec vs sonnet-plain | all | resolved | 15 | 100% | 28% | +72.2 pts | [49.2, 95.3] | 0.000 | 12 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | all | fail-to-pass share | 15 | 100% | 50% | +50.1 pts | [28.9, 71.3] | 0.000 | 12 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | held-out | resolved | 7 | 100% | 19% | +81.0 pts | [46.0, 115.9] | 0.001 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | held-out | fail-to-pass share | 7 | 100% | 42% | +57.7 pts | [23.4, 92.1] | 0.006 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | dev | resolved | 8 | 100% | 35% | +64.6 pts | [26.3, 102.9] | 0.005 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain | dev | fail-to-pass share | 8 | 100% | 57% | +43.5 pts | [9.6, 77.3] | 0.019 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | all | resolved | 15 | 100% | 33% | +66.7 pts | [40.8, 92.5] | 0.000 | 11 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | all | fail-to-pass share | 15 | 100% | 55% | +45.3 pts | [24.2, 66.4] | 0.000 | 11 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | held-out | resolved | 7 | 100% | 29% | +71.4 pts | [30.9, 111.9] | 0.005 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | held-out | fail-to-pass share | 7 | 100% | 53% | +47.0 pts | [13.0, 81.0] | 0.015 | 6 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | dev | resolved | 8 | 100% | 38% | +62.5 pts | [19.2, 105.8] | 0.011 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs sonnet-plain-rules | dev | fail-to-pass share | 8 | 100% | 56% | +43.8 pts | [8.9, 78.6] | 0.021 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | all | resolved | 15 | 100% | 44% | +55.6 pts | [29.5, 81.6] | 0.000 | 10 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | all | fail-to-pass share | 15 | 100% | 65% | +35.3 pts | [15.8, 54.8] | 0.002 | 10 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | held-out | resolved | 7 | 100% | 40% | +59.5 pts | [12.6, 106.5] | 0.021 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | held-out | fail-to-pass share | 7 | 100% | 66% | +33.9 pts | [0.3, 67.6] | 0.049 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | dev | resolved | 8 | 100% | 48% | +52.1 pts | [13.1, 91.1] | 0.016 | 5 / 0 | sonnet-spec better |
| sonnet-spec vs opus-plain | dev | fail-to-pass share | 8 | 100% | 64% | +36.5 pts | [5.8, 67.2] | 0.026 | 5 / 0 | sonnet-spec better |
| sonnet-plain-rules vs sonnet-plain | all | resolved | 15 | 33% | 28% | +5.6 pts | [-3.5, 14.6] | 0.207 | 3 / 1 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | all | fail-to-pass share | 15 | 55% | 50% | +4.9 pts | [-2.7, 12.5] | 0.192 | 4 / 2 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | held-out | resolved | 7 | 29% | 19% | +9.5 pts | [-8.0, 27.0] | 0.231 | 2 / 0 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | held-out | fail-to-pass share | 7 | 53% | 42% | +10.7 pts | [-6.4, 27.8] | 0.175 | 3 / 0 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | dev | resolved | 8 | 38% | 35% | +2.1 pts | [-9.5, 13.7] | 0.685 | 1 / 1 | no measurable difference |
| sonnet-plain-rules vs sonnet-plain | dev | fail-to-pass share | 8 | 56% | 57% | -0.3 pts | [-4.0, 3.5] | 0.875 | 1 / 2 | no measurable difference |
| sonnet-plain-rules vs opus-plain | all | resolved | 15 | 33% | 44% | -11.1 pts | [-25.4, 3.1] | 0.116 | 1 / 4 | no measurable difference |
| sonnet-plain-rules vs opus-plain | all | fail-to-pass share | 15 | 55% | 65% | -10.0 pts | [-23.1, 3.1] | 0.125 | 2 / 6 | no measurable difference |
| sonnet-plain-rules vs opus-plain | held-out | resolved | 7 | 29% | 40% | -11.9 pts | [-42.4, 18.6] | 0.376 | 1 / 2 | no measurable difference |
| sonnet-plain-rules vs opus-plain | held-out | fail-to-pass share | 7 | 53% | 66% | -13.1 pts | [-43.4, 17.2] | 0.331 | 2 / 4 | no measurable difference |
| sonnet-plain-rules vs opus-plain | dev | resolved | 8 | 38% | 48% | -10.4 pts | [-27.0, 6.1] | 0.180 | 0 / 2 | no measurable difference |
| sonnet-plain-rules vs opus-plain | dev | fail-to-pass share | 8 | 56% | 64% | -7.3 pts | [-18.7, 4.1] | 0.175 | 0 / 2 | no measurable difference |
| opus-plain vs sonnet-plain | all | resolved | 15 | 44% | 28% | +16.7 pts | [1.5, 31.9] | 0.034 | 5 / 0 | opus-plain better |
| opus-plain vs sonnet-plain | all | fail-to-pass share | 15 | 65% | 50% | +14.9 pts | [0.3, 29.4] | 0.046 | 8 / 1 | opus-plain better |
| opus-plain vs sonnet-plain | held-out | resolved | 7 | 40% | 19% | +21.4 pts | [-12.7, 55.6] | 0.175 | 2 / 0 | no measurable difference |
| opus-plain vs sonnet-plain | held-out | fail-to-pass share | 7 | 66% | 42% | +23.8 pts | [-9.0, 56.6] | 0.126 | 5 / 0 | no measurable difference |
| opus-plain vs sonnet-plain | dev | resolved | 8 | 48% | 35% | +12.5 pts | [-1.9, 26.9] | 0.080 | 3 / 0 | no measurable difference |
| opus-plain vs sonnet-plain | dev | fail-to-pass share | 8 | 64% | 57% | +7.0 pts | [-3.3, 17.4] | 0.151 | 3 / 1 | no measurable difference |
