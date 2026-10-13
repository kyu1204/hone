#!/usr/bin/env bash
# Renders .github/assets/demo.gif with VHS (https://github.com/charmbracelet/vhs). Needs vhs, ttyd and ffmpeg on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v vhs >/dev/null; then
  echo "vhs not found: brew install vhs (or see https://github.com/charmbracelet/vhs)"; exit 1
fi
vhs .github/assets/demo.tape
rm -rf examples/sharpen/.hone
ls -la .github/assets/demo.gif
