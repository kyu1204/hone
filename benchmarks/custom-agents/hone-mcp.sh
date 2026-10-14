#!/bin/bash
# hone-mcp.sh <project dir>
# The MCP server a coding agent talks to. It holds the key the agent under test needs (read from ~/.config/hone/env), so
# the coding agent's own shell never does. It only judges: hone's model writes no rewrite of its own.
set -euo pipefail
set -a
. "$HOME/.config/hone/env"
set +a
cd "$1"
# an MCP client starts its servers with a short PATH: look for bun where it usually lives
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin"
exec bun node_modules/honed/dist/cli.js serve mcp --no-rewrites
