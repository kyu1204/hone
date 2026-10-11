# VHS script for the README demo. Render with: scripts/demo.sh (needs vhs, ttyd, ffmpeg).
Output .github/assets/demo.gif
Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 640
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set Padding 16

Hide
Type "cd examples/harness-ablation && rm -rf .hone && alias hone='bun ../../src/cli.ts' && clear"
Enter
Show

Type "hone ablate      # remove one rule at a time, paired delta per rule"
Sleep 400ms
Enter
Sleep 4s

Type "clear"
Enter
Type "hone optimize --budget 12 --batch 4 --seed 1   # Thompson sampling, then a paired verdict"
Sleep 400ms
Enter
Sleep 4500ms

Type "clear"
Enter
Type "hone    # the dashboard over the latest run"
Sleep 300ms
Enter
Sleep 2500ms
Type "j"
Sleep 700ms
Enter
Sleep 3s
Type "j"
Sleep 600ms
Type "j"
Sleep 600ms
Type "j"
Sleep 1500ms
Escape
Sleep 700ms
Type "8"
Sleep 2500ms
Type "q"
Sleep 400ms
