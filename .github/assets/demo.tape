# VHS script for the README demo. Render with: scripts/demo.sh (needs vhs, ttyd, ffmpeg, and an LLM key in
# ~/.config/hone/env: hone sharpen asks a model to name the failure modes and to write one rewrite).
Output .github/assets/demo.gif
Set Shell "bash"
Set FontSize 15
Set Width 1180
Set Height 720
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set Padding 16

Hide
Type "cd examples/sharpen && rm -rf .hone && set -a && . ~/.config/hone/env && set +a && alias hone='bun ../../src/cli.ts' && clear"
Enter
Show

Type "hone test --quiet      # 18 cases against the bot as it is"
Sleep 400ms
Enter
Sleep 5s

Type "clear"
Enter
Type "hone sharpen           # why they fail, each change tried, a verdict on cases no change saw"
Sleep 400ms
Enter
Sleep 26s
