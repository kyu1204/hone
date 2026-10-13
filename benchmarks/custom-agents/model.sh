#!/bin/bash
# model.sh <project dir> <out dir>
# The cycle with hone's own model writing the rewrites: no change file, no coding agent. Spending on the agent under test
# stops at 4 dollars of tried changes; the held-out check comes on top.
set -euo pipefail
dir=$(cd "$1" && pwd)
mkdir -p "$2"
out=$(cd "$2" && pwd)
set -a
. "$HOME/.config/hone/env"
set +a
cd "$dir"
start=$(date +%s)
bunx hone sharpen --max-cost 4 > "$out/account.txt" 2> "$out/progress.log"
echo "$(( $(date +%s) - start ))" > "$out/seconds.txt"
cp .hone/sharpen/* "$out/"
