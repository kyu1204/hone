#!/usr/bin/env python3
"""summarize.py <project dir> : what one arm did, read from its ledger and its stored runs.

Prints the baseline, every candidate, the verdict, the held-out result by rule, and what the agent under test cost."""
import collections, glob, json, os, re, sys

proj = sys.argv[1]
hone = os.path.join(proj, ".hone")
ledgers = sorted(p for p in glob.glob(os.path.join(hone, "sharpen", "*.json")) if re.fullmatch(r"\d+\.json", os.path.basename(p)))
rules = {c["id"]: c["tags"][0] for c in json.load(open(os.path.join(proj, "evals", "cases.yaml")))}
ORDER = ["cite", "verify", "lookup", "ticket", "security", "nopolicy"]

runs = {}
for p in glob.glob(os.path.join(hone, "runs", "*", "run.json")):
    run = json.load(open(p))
    trials = [json.load(open(t)) for t in glob.glob(os.path.join(os.path.dirname(p), "trials", "*.json"))]
    runs[run["id"]] = {"label": (run.get("summary") or {}).get("ablation"), "trials": trials, "created": run["createdAt"], "summary": run.get("summary")}

def by_rule(trials):
    out = collections.defaultdict(lambda: [0, 0])
    for t in trials:
        r = out[rules[t["trace"]["caseId"]]]
        r[1] += 1
        r[0] += 1 if t["pass"] else 0
    return out

# a trial answered from the cache carries the cost of the run that produced it, and cost nothing this time
fresh = [t for r in runs.values() for t in r["trials"] if "cached" not in [f if isinstance(f, str) else f.get("kind") for f in t.get("flags", [])]]
total_trials = sum(len(r["trials"]) for r in runs.values())
errors = sum(1 for t in fresh if t["trace"].get("error"))
seconds = sum((r.get("summary") or {}).get("totals", {}).get("durationMs", 0) for r in runs.values()) / 1000
print(f"runs {len(runs)}, trials {total_trials}, of which {len(fresh)} ran the agent ({errors} errored); spent on the agent ${sum(t.get('costUsd') or 0 for t in fresh):.2f}")
for path in ledgers:
    L = json.load(open(path))
    print(f"\n== ledger {L['id']}: verdict {L['verdict']}, stopped by {L['stopped']}")
    print(f"dev {len(L['split']['dev'])} cases, held out {len(L['split']['holdout'])}; baseline on dev {L['baseline']['dev']:.0%} ({L['baseline']['trials']} trials, {L['baseline']['errors']} errors)")
    for d in L["diagnosis"]:
        print(f"  mode {d['code']} ({d['size']}): {d['definition'][:110]}")
    for c in L["candidates"]:
        res = f"dropped ({c['dropped']}" + (f": {c['sample']['candidate']:.0%} vs {c['sample']['parent']:.0%} on {c['sample']['cases']})" if c.get("sample") else ")") if c.get("dropped") else f"dev {c['dev']:.0%}"
        print(f"  {c['id']:<44} {c['source']:<6} parent {c['parent']:<22} {res:<34} ${c['costUsd']:.2f}")
    b = L.get("best")
    if b:
        print(f"best: {b['label']}: held-out {b['baseline']:.0%} -> {b['candidate']:.0%} on {b['cases']} cases, diff {b['diff']:+.0%} [{b['lo']:+.0%}, {b['hi']:+.0%}], p {b['p']:.4f}, level {b['alpha']:.3f}, cost ratio {b.get('costRatio', 0):.2f}, needed {b.get('needed')}")
        # the two held-out runs of this ledger: the first ones made after it started (its id is its start time, UTC)
        start = f"{L['id'][:4]}-{L['id'][4:6]}-{L['id'][6:8]}T{L['id'][8:10]}:{L['id'][10:12]}:{L['id'][12:14]}"
        after = sorted((r for r in runs.values() if r["label"] and r["label"].endswith("held-out cases") and r["created"] >= start), key=lambda r: r["created"])
        base_run = next((r for r in after if r["label"].startswith("baseline")), {"trials": []})
        win_run = next((r for r in after if r["label"] == f"{b['id']}, held-out cases"), {"trials": []})
        base, win = by_rule(base_run["trials"]), by_rule(win_run["trials"])
        print("held-out trials passed, by rule (baseline -> winner):")
        for r in ORDER:
            if base[r][1] or win[r][1]:
                print(f"  {r:<9} {base[r][0]}/{base[r][1]} -> {win[r][0]}/{win[r][1]}")
        per = lambda ts: {c: sum(1 for t in ts if t["trace"]["caseId"] == c and t["pass"]) for c in sorted({t["trace"]["caseId"] for t in ts})}
        pb, pw = per(base_run["trials"]), per(win_run["trials"])
        worse = [f"{c} {pb[c]}->{pw.get(c)}" for c in pb if pw.get(c, 0) < pb[c]]
        still = [f"{c} {pw[c]}/2" for c in pw if pw[c] < 2]
        why = sorted({s["reason"] for t in win_run["trials"] if not t["pass"] for s in t["scores"] if s.get("pass") is False})
        print(f"  worse on held-out: {worse or 'none'}; not passing every trial: {still or 'none'}")
        for w_ in why: print(f"    reason: {w_[:170]}")
        w = next((c for c in L["candidates"] if c["id"] == b["id"]), None)
        if w and w.get("text"):
            print("winning text:\n" + w["text"])
