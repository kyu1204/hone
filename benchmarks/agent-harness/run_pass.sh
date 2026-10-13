#!/bin/sh
# Runs every cell of the study, one after the other. A stage that stops at the subscription guard (exit 3) is retried
# every 15 minutes; run_stage.py skips what is already recorded in runs.json.
cd "$(dirname "$0")" || exit 1
mkdir -p logs
for t in sonnet-spec sonnet-plain sonnet-plain-rules opus-plain; do
  n=0
  until python3 run_stage.py "$t" >> "logs/stage-$t.log" 2>&1; do
    code=$?
    if [ "$code" -ne 3 ] || [ "$n" -ge 12 ]; then echo "$t stopped with exit $code"; exit "$code"; fi
    n=$((n + 1)); sleep 900
  done
  echo "$t done $(date +%H:%M)"
done
