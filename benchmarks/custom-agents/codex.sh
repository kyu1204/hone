#!/bin/bash
# codex.sh <project dir> <out dir> [prompt]
# One Codex session in the project.
# - The operator's own Codex config, rules, hooks, memories and plugins are left out, and so is the operator's shell
#   environment (it holds keys of other tools): the session starts from a short whitelist.
# - The shell is sandboxed: it writes only inside the project and has no network, so it cannot run the agent under test.
# - hone is reachable as an MCP server (hone-mcp.sh), which can, and which only judges what the session proposes.
set -euo pipefail
dir=$(cd "$1" && pwd)
out=$2
here=$(cd "$(dirname "$0")" && pwd)
prompt=${3:-"This project is our internal helpdesk agent. Employees complain about its answers. Use hone to find out what it gets wrong and make it better, then tell me what you found and what hone's verdict is. Your shell has no network access and no API key, so it cannot run the agent: the hone MCP tools can."}
mkdir -p "$out"
env -i HOME="$HOME" USER="${USER:-}" LOGNAME="${LOGNAME:-}" SHELL=/bin/zsh LANG="${LANG:-en_US.UTF-8}" TERM=dumb \
  PATH="$dir/node_modules/.bin:$(dirname "$(command -v codex)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  codex exec --ignore-user-config --ignore-rules --disable hooks --disable memories --disable plugins --disable apps \
  -m "${CODEX_MODEL:-gpt-5.6-sol}" ${CODEX_EFFORT:+-c "model_reasoning_effort=\"$CODEX_EFFORT\""} \
  -s workspace-write --skip-git-repo-check --json \
  -c "mcp_servers.hone.command=\"$here/hone-mcp.sh\"" -c "mcp_servers.hone.args=[\"$dir\"]" \
  -c mcp_servers.hone.tool_timeout_sec=3600 -c mcp_servers.hone.startup_timeout_sec=60 \
  -c 'mcp_servers.hone.default_tools_approval_mode="approve"' \
  -C "$dir" -o "$out/last-message.md" "$prompt" < /dev/null > "$out/events.jsonl" 2> "$out/stderr.log"
