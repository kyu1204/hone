#!/usr/bin/env bash
# Confirmatory 3-trial comparison (baseline, v3-k30, best evolved prompt when .hone/evolve has one). Logs in logs/confirm.log.
set -u
cd "$(dirname "$0")/confirm"
hone() { bun /Users/minkyu/Documents/evaluation/src/cli.ts "$@"; }
echo "=== confirm $(date)"; rm -rf .hone; hone run --no-cache 2>&1 | tail -3; hone matrix 2>&1 | sed -n 3,7p
for pair in "v3-k30 baseline" "evolved baseline" "evolved v3-k30"; do echo "--- $pair (pass = useful)"; hone compare $pair 2>&1 | sed -n 2,8p; echo "--- $pair (mean 0/1/2 score)"; hone compare $pair --scorer grade 2>&1 | sed -n 2,7p; done
for t in baseline v3-k30 evolved; do echo "--- breakdown $t"; bun ../breakdown-target.ts "$t"; done
echo "=== done $(date)"
