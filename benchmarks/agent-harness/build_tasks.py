#!/usr/bin/env python3
"""Builds the agent-harness benchmark tasks from this repository's own history, SWE-bench style.

For each (id, commit): the task workspace is the repository at the commit's PARENT (every tracked file except
harness files), so the existing tests stay visible. The commit's version of its test files is kept aside as the
hidden tests; the grader puts them in place and runs them. Per test we record whether it fails before the change
(FAIL_TO_PASS) or already passes (PASS_TO_PASS), measured, not assumed.

Layout (two roots on purpose; see README.md):
  PUBLIC  /private/tmp/hone-bench/agent-harness      readable by sandboxed agents: node_modules only
  PRIVATE ~/.cache/hone-bench/agent-harness          under /Users, which the sandbox denies: pristine task trees (a later
                                                     task's tree contains an earlier task's solution), hidden tests,
                                                     the grader's copies, and the per-trial workspaces (work/); an agent
                                                     can read only its own workspace, because it is its working directory
Writes cases.json and baseline.json next to this script."""
import json, os, random, re, shutil, subprocess, sys, tempfile, xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PUBLIC = Path(os.environ.get("HONE_BENCH_PUBLIC", "/private/tmp/hone-bench/agent-harness"))
PRIVATE = Path(os.environ.get("HONE_BENCH_PRIVATE", str(Path.home() / ".cache/hone-bench/agent-harness")))
# harness and study files are not part of the product: the harness is the variable under test
EXCLUDE = [".claude", ".codex", ".pi", ".omh", "AGENTS.md", "CLAUDE.md", "harness.yaml", "benchmarks", "docs/benchmarks"]
SEED = 20261013

TASKS = [  # id, commit, kind
    ("matrix-errors", "ffa8450", "fix"), ("evolve-max-tokens", "0804531", "fix"), ("calibrate-cases", "dd6d43b", "fix"),
    ("cache-per-trial", "d42a198", "fix"), ("cluster-induce-errors", "34bc093", "fix"), ("anthropic-temperature", "48baf6e", "fix"),
    ("fork-first-user", "7a2904d", "fix"), ("synth-messages", "d3f37e4", "fix"), ("matrix-undecided", "52f470a", "fix"),
    ("embed-provider", "ef5d00e", "feat"), ("failure-clustering", "0813dd8", "feat"), ("taxonomy", "d59c303", "feat"),
    ("judge-calibration", "514311f", "feat"), ("branchpoints", "03052fb", "feat"), ("rollouts-export", "ec20866", "feat"),
]

def sh(cmd, cwd=None, check=True):
    return subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str), capture_output=True, text=True, check=check)

def export_tree(rev, dest):
    dest.mkdir(parents=True, exist_ok=True)
    sh(f"git -C {REPO} archive {rev} | tar -x -C {dest}")
    for e in EXCLUDE:
        p = dest / e
        if p.is_dir(): shutil.rmtree(p)
        elif p.exists(): p.unlink()
    os.symlink(PUBLIC / "deps" / "node_modules", dest / "node_modules")

def junit(cwd, args, timeout=900):
    """{ 'file :: describe > test': 'pass'|'fail' }, exit code. A file that fails to load contributes nothing."""
    out = Path(tempfile.mkstemp(suffix=".xml")[1])
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "AGENT")}
    r = subprocess.run(["bun", "test", *args, "--reporter=junit", f"--reporter-outfile={out}"], cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
    res = {}
    try:
        for tc in ET.parse(out).getroot().iter("testcase"):
            cls = " > ".join(reversed([c for c in (tc.get("classname") or "").split(" > ") if c]))
            name = f"{tc.get('file')} :: {cls + ' > ' if cls else ''}{tc.get('name')}"
            res[name] = "fail" if (tc.find("failure") is not None or tc.find("error") is not None) else ("skip" if tc.find("skipped") is not None else "pass")
    except Exception:
        pass
    finally:
        out.unlink(missing_ok=True)
    return res, r.returncode, (r.stdout + r.stderr)[-2000:]

def build(task):
    tid, commit, kind = task
    subject = sh(f"git -C {REPO} log -1 --format=%s {commit}").stdout.strip()
    changed = [l.split("\t") for l in sh(f"git -C {REPO} show --name-status --format= {commit}").stdout.strip().splitlines()]
    tests = [p for _, p in changed if re.search(r"\.test\.tsx?$", p)]
    new_files = [p for s, p in changed if s == "A" and p in tests]
    # the task workspace: the parent commit
    ws = PRIVATE / "tasks" / tid
    export_tree(f"{commit}~", ws)
    sh("git init -q && echo node_modules >> .git/info/exclude && git add -A && git -c user.name=hone -c user.email=hone@localhost commit -qm 'task base'", cwd=ws)
    # hidden tests: the commit's versions
    hidden = PRIVATE / "hidden" / tid
    for t in tests:
        (hidden / t).parent.mkdir(parents=True, exist_ok=True)
        (hidden / t).write_text(sh(f"git -C {REPO} show {commit}:{t}").stdout)
    scratch = Path(tempfile.mkdtemp(prefix=f"hone-build-{tid}-", dir=PRIVATE / "scratch"))
    try:
        ref_dir = scratch / "ref"; export_tree(commit, ref_dir)
        ref, ref_code, ref_tail = junit(ref_dir, tests)
        base_dir = scratch / "base"; export_tree(f"{commit}~", base_dir)
        before, _, _ = junit(base_dir, [t for t in tests if t not in new_files]) if any(t not in new_files for t in tests) else ({}, 0, "")
        for t in tests:
            (base_dir / t).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(hidden / t, base_dir / t)
        base, base_code, _ = junit(base_dir, tests)
        suite_dir = scratch / "suite"; export_tree(f"{commit}~", suite_dir)
        suite, suite_code, suite_tail = junit(suite_dir, ["src"])
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    assert ref and ref_code == 0 and all(v == "pass" for v in ref.values()), f"{tid}: reference solution does not pass its tests: {ref_tail}"
    f2p = sorted(n for n in ref if base.get(n) != "pass")
    p2p = sorted(n for n in ref if base.get(n) == "pass")
    assert f2p, f"{tid}: no test fails before the change"
    changed_tests = sorted(set(f2p) | {n for n in ref if n not in before})
    removed_tests = sorted(n for n in before if n not in ref)
    imports = {t: re.findall(r'^import .*? from "\.[^"]*";', (hidden / t).read_text(), re.M) for t in new_files}
    suite_failed = sorted(n for n, v in suite.items() if v == "fail")
    return {"id": tid, "commit": commit, "kind": kind, "subject": subject, "tests": tests, "newTestFiles": new_files, "f2p": f2p, "p2p": p2p,
            "changedTests": changed_tests, "removedTests": removed_tests, "imports": imports,
            "suite": {"pass": sum(v == "pass" for v in suite.values()), "fail": len(suite_failed), "exit": suite_code, "failed": suite_failed[:10]}}

def prompt(t):
    short = lambda n: n.split(" :: ", 1)[1]
    files = ", ".join(f"`{x}`" for x in t["tests"])
    lines = ["You are working in a checkout of the hone repository (TypeScript on Bun).", "", f'Change to make: "{t["subject"]}"', "",
             f"How it will be checked: when you finish, the maintainers' version of {files} is put in place of whatever is at that path and `bun test {' '.join(t['tests'])}` is run. Every test in their version must pass.",
             "Their version adds or changes these tests:", *[f"- {short(n)}" for n in t["changedTests"]]]
    if t["removedTests"]:
        lines += ["It no longer contains these tests, which are in the current file:", *[f"- {short(n)}" for n in t["removedTests"]]]
    if t["p2p"]:
        lines += [f"The other {len([n for n in t['p2p'] if n not in t['changedTests']])} tests in their version are the ones already in the repository and must keep passing."]
    for f, imps in t["imports"].items():
        lines += ["", f"`{f}` is a new file. It starts with these imports, so those names must exist at those paths:", *[f"  {i}" for i in imps]]
    lines += ["", "Environment: dependencies are installed, `bun test <path>` runs tests, and there is no network access. Work only inside this directory."]
    return "\n".join(lines)

def main():
    shutil.rmtree(PUBLIC / "tasks", ignore_errors=True)
    for d in (PRIVATE / "tasks", PRIVATE / "tasks-hidden", PRIVATE / "hidden", PRIVATE / "scratch", PRIVATE / "grading", PRIVATE / "work"):
        shutil.rmtree(d, ignore_errors=True)
    for d in (PRIVATE / "tasks", PRIVATE / "hidden", PRIVATE / "scratch", PRIVATE / "grading", PRIVATE / "work"):
        d.mkdir(parents=True, exist_ok=True)
    deps = PUBLIC / "deps" / "node_modules"
    if not deps.exists():
        deps.parent.mkdir(parents=True, exist_ok=True)
        if subprocess.run(["cp", "-cR", str(REPO / "node_modules"), str(deps)]).returncode != 0:
            shutil.copytree(REPO / "node_modules", deps, symlinks=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        tasks = list(ex.map(build, TASKS))
    rng = random.Random(SEED)
    split = {}
    for kind, n_dev in (("fix", 5), ("feat", 3)):
        ids = sorted(t["id"] for t in tasks if t["kind"] == kind); rng.shuffle(ids)
        for i, tid in enumerate(ids): split[tid] = "dev" if i < n_dev else "heldout"
    cases = []
    for t in sorted(tasks, key=lambda t: t["id"]):
        t["split"] = split[t["id"]]
        cases.append({"id": t["id"], "input": prompt(t), "tags": [t["kind"], t["split"]],
                      "meta": {k: t[k] for k in ("commit", "kind", "split", "subject", "tests", "f2p", "p2p")}})
    (HERE / "cases.json").write_text(json.dumps(cases, indent=1, ensure_ascii=False) + "\n")
    (HERE / "baseline.json").write_text(json.dumps(sorted(tasks, key=lambda t: t["id"]), indent=1, ensure_ascii=False) + "\n")
    print(f"{'task':<24}{'kind':<5}{'split':<8}{'f2p':>4}{'p2p':>4}  suite(pass/fail)")
    for t in sorted(tasks, key=lambda t: t["id"]):
        print(f"{t['id']:<24}{t['kind']:<5}{t['split']:<8}{len(t['f2p']):>4}{len(t['p2p']):>4}  {t['suite']['pass']}/{t['suite']['fail']}" + (f"  FAILING: {t['suite']['failed'][:3]}" if t['suite']['fail'] else ""))

if __name__ == "__main__":
    main()
