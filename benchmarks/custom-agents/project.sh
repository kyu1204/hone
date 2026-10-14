#!/bin/bash
# project.sh <langchain|strands> <dir>
# A stand-alone copy of examples/helpdesk-agent with one framework, hone installed as a package and the skill in place:
# what a team's own project looks like before anyone tried to improve the agent. The example's README is left out,
# because it spells out the house rules the agent is supposed to be missing.
set -euo pipefail
fw=$1
dir=$2
repo=$(cd "$(dirname "$0")/../.." && pwd)
src=$repo/examples/helpdesk-agent
[ -e "$dir" ] && { echo "$dir exists" >&2; exit 1; }
[ -x "$src/.venv/bin/python" ] || { echo "run uv sync in $src first" >&2; exit 1; }
mkdir -p "$dir/evals"
cp "$src/helpdesk.py" "$src/${fw}_agent.py" "$src/pyproject.toml" "$dir/"
cp "$src/evals/cases.yaml" "$dir/evals/"
ln -s "$src/.venv" "$dir/.venv"
python3 - "$src/hone.config.ts" "$dir/hone.config.ts" "$fw" <<'PY'
import sys
src, dst, fw = sys.argv[1:]
s = open(src).read()
def swap(old, new):
    global s
    assert old in s, old
    s = s.replace(old, new)
head = s[: s.index("import { defineConfig")]
swap(head, f"// The Acme internal helpdesk agent ({'LangChain' if fw == 'langchain' else 'Strands'}), checked against the cases in evals/.\n")
swap('from "../../src/index.ts"; // in your project: from "honed"', 'from "honed";')
swap('const only = process.env.HONE_AGENT; // langchain | strands; both when unset\nconst agents = { langchain: "langchain_agent", strands: "strands_agent" };', f'const only = undefined;\nconst agents = {{ {fw}: "{fw}_agent" }};')
open(dst, "w").write(s)
PY
# hone as the package a registry would serve (only the files it publishes), not a copy of this repository: the copy
# would bring the example's README, and with it the house rules, into the project
pack=$(mktemp -d)
(cd "$repo" && bun run build > /dev/null && bun pm pack --destination "$pack" > /dev/null)
cd "$dir"
printf '{ "name": "helpdesk", "private": true }\n' > package.json
bun add -d "$pack"/honed-*.tgz > /dev/null 2>&1
bunx hone init --skills > /dev/null
printf '.hone/\nnode_modules/\n.venv\n__pycache__/\n' > .gitignore
echo "$dir"
