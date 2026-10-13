#!/usr/bin/env python3
"""Runs one target over the task set in small batches and stops cleanly when the Claude subscription is nearly used up.

  run_stage.py <target> [--tags dev,heldout] [--batch 3] [--max-five-hour 0.88] [--max-seven-day 0.70]

Each batch is one `hone test` (its own run id) with TMPDIR pointed at the private work directory so workspaces are
created where only their own agent can read them. Progress is appended to runs.json; cases already done for the target
are skipped, so the same command resumes after a limit resets. A batch in which any trial errored is not recorded.
Targets with "-spec" in the name get the statement with written requirements (cases-spec.json), the others the title-only one."""
import json, os, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
HONE = ["bun", str(HERE.parent.parent / "src" / "cli.ts")]
PRIVATE = Path(os.environ.get("HONE_BENCH_PRIVATE", str(Path.home() / ".cache/hone-bench/agent-harness")))
RUNS = HERE / "runs.json"

def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

target = sys.argv[1]
tags = set(arg("--tags", "dev,heldout").split(","))
batch_size = int(arg("--batch", "3"))
max5, max7 = float(arg("--max-five-hour", "0.88")), float(arg("--max-seven-day", "0.70"))
cases = [c for c in json.loads((HERE / "cases.json").read_text()) if tags & set(c["tags"])]
runs = json.loads(RUNS.read_text()) if RUNS.exists() else []
done = {c for r in runs if r["target"] == target for c in r["cases"]}
todo = [c["id"] for c in cases if c["id"] not in done]
print(f"{target}: {len(done)} cases done, {len(todo)} to run", flush=True)
# A clean environment on purpose: started from inside a Claude Code session, the agents would otherwise inherit that
# session's variables (CLAUDE_EFFORT, CLAUDE_CODE_CHILD_SESSION, the messaging socket, ...).
KEEP = ("HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "LC_ALL", "TERM")
env = {k: os.environ[k] for k in KEEP if k in os.environ}
env.update({k: v for k, v in os.environ.items() if k.startswith("HONE_BENCH_")})
env.update({"TMPDIR": str(PRIVATE / "work"), "HONE_BENCH_STATEMENT": "spec" if "-spec" in target else "title"})
(PRIVATE / "work").mkdir(parents=True, exist_ok=True)

for i in range(0, len(todo), batch_size):
    batch = todo[i:i + batch_size]
    out = HERE / "logs" / f"run-{target}-{int(time.time())}.json"
    cmd = [*HONE, "test", "--no-cache", "--quiet", "--target", target, "--json", str(out)] + [x for c in batch for x in ("--case", c)]
    started = time.time()
    r = subprocess.run(cmd, cwd=HERE, env=env, capture_output=True, text=True)
    if not out.exists():
        print(f"batch {batch}: hone test failed (exit {r.returncode}): {(r.stderr or r.stdout)[-400:]}", flush=True); sys.exit(1)
    doc = json.loads(out.read_text())
    trials = [json.loads(p.read_text()) for p in sorted((HERE / ".hone" / "runs" / doc["runId"] / "trials").glob("*.json"))]
    errors = [t["trace"].get("error") for t in trials if t["trace"].get("error")]
    limits = [t["trace"].get("meta", {}).get("rateLimit") for t in trials if t["trace"].get("meta", {}).get("rateLimit")]
    five = max((l.get("fiveHour") or 0 for l in limits), default=0); seven = max((l.get("sevenDay") or 0 for l in limits), default=0)
    passed = sum(1 for t in trials if t["pass"] is True)
    cost = sum(t["costUsd"] for t in trials)
    print(f"batch {batch}: {passed}/{len(trials)} resolved, {len(errors)} errors, est ${cost:.2f}, {time.time() - started:.0f}s, five_hour {five:.2f}, seven_day {seven:.2f}", flush=True)
    if errors:
        print(f"stopping: trial errors, batch not recorded: {errors[0][:200]}", flush=True); sys.exit(2)
    runs.append({"target": target, "cases": batch, "runId": doc["runId"], "fiveHour": five, "sevenDay": seven})
    RUNS.write_text(json.dumps(runs, indent=1) + "\n")
    if five >= max5 or seven >= max7:
        print(f"stopping: subscription utilization five_hour {five:.2f} (limit {max5}) seven_day {seven:.2f} (limit {max7})", flush=True); sys.exit(3)
print(f"{target}: complete", flush=True)
