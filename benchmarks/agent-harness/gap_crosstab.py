#!/usr/bin/env python3
"""For every unresolved trial: did it fail only tests that the title-only statement does not determine
(contracts/gaps.json), or also a test the statement does determine? Prints one line per target.
Usage: gap_crosstab.py [runs.json]"""
import collections, glob, json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
runs = json.loads((HERE / (sys.argv[1] if len(sys.argv) > 1 else "runs.json")).read_text())
gaps = json.loads((HERE / "contracts" / "gaps.json").read_text())
blocked = {k: {u["test"] for u in v["undetermined"]} for k, v in gaps.items()}
res, examples = collections.defaultdict(collections.Counter), collections.defaultdict(dict)
for r in runs:
    for f in sorted(glob.glob(str(HERE / ".hone" / "runs" / r["runId"] / "trials" / "*.json"))):
        d = json.loads(Path(f).read_text()); tr = d["trace"]; score = {s["scorer"]: s for s in d["scores"]}["resolved"]
        if score["pass"] is True:
            res[tr["targetId"]]["resolved"] += 1; continue
        ev = (score.get("evidence") or [{}])[0]
        failed, broken = ev.get("f2pFailed", []), ev.get("p2pBroken") or []
        own = [t for t in failed if t not in blocked[tr["caseId"]]]
        if broken: kind = "broke an existing test"
        elif not failed: kind = "tests did not run"
        elif not own: kind = "failed only tests the statement does not determine"
        else:
            kind = "failed a test the statement determines"; examples[tr["targetId"]].setdefault(tr["caseId"], own)
        res[tr["targetId"]][kind] += 1
for t, c in res.items():
    print(t, dict(c))
    for case, tests in examples[t].items(): print("    ", case, [x[:80] for x in tests[:2]])
