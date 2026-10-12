#!/usr/bin/env bash
# Remaining stages after the key was restored: evolve -> ablate -> confirmatory 3-trial comparison. Logs in logs/study-part2.log.
set -u
cd "$(dirname "$0")"
hone() { bun /Users/minkyu/Documents/evaluation/src/cli.ts "$@"; }
echo "=== evolve $(date)"; hone evolve --budget 3 --minibatch 6 --no-cache 2>&1 | tail -12
echo "=== ablate $(date)"; hone ablate --no-cache 2>&1 | tail -8
echo "=== confirm $(date)"; (cd confirm && rm -rf .hone && hone run --no-cache 2>&1 | tail -3 && hone matrix 2>&1 | sed -n 3,7p && echo "--- v3-k30 vs baseline" && hone compare v3-k30 baseline 2>&1 | sed -n 2,8p && echo "--- evolved vs baseline" && hone compare evolved baseline 2>&1 | sed -n 2,8p && echo "--- evolved vs v3-k30" && hone compare evolved v3-k30 2>&1 | sed -n 2,8p && echo "--- mean score, evolved vs baseline" && hone compare evolved baseline --scorer grade 2>&1 | sed -n 2,8p)
echo "=== done $(date)"
