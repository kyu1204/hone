# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: **Security** tab -> **Report a vulnerability** on https://github.com/kyu1204/hone. Do not open a public issue for security problems. You will get a first reply within 7 days.

## Supported versions

Only the latest minor release line receives fixes (0.1.x once 0.1.0 ships).

## What hone touches

hone runs the targets you configure (HTTP calls, local functions, Python modules, CLI agents in isolated workspaces, MCP servers, Docker containers) and sends traces to the judges you configure (Jev, OpenAI-compatible or Anthropic APIs). It stores results under `.hone/` in your project and keys under `~/.config/hone/env` (mode 0600). It makes no other network calls.
