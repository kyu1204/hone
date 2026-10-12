#!/usr/bin/env bash
# The whole study, sequentially (one store): baseline -> calibrate -> taxonomy -> optimize -> evolve -> ablate. Logs in logs/study.log.
set -u
cd "$(dirname "$0")"
hone() { bun ../../src/cli.ts "$@"; }
rm -rf .hone
echo "=== baseline $(date)"; hone run --no-cache 2>&1 | tail -3
B=$(ls -t .hone/runs | head -1); echo "baseline run $B"; bun breakdown.ts "$B"
echo "=== calibrate $(date)"; hone calibrate --scorer grade --domain rag --run "$B" --n 12 2>&1 | tail -8
echo "=== induce $(date)"; hone cluster --induce --run "$B" 2>&1 | tail -8
echo "=== optimize $(date)"; hone optimize --budget 60 --batch 10 --seed 1 --no-cache 2>&1 | tail -12
echo "=== evolve $(date)"; hone evolve --budget 3 --minibatch 6 --no-cache 2>&1 | tail -10
echo "=== ablate $(date)"; hone ablate --no-cache 2>&1 | tail -8
echo "=== done $(date)"
