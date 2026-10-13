# custom-agents

The cycle on an in-house agent built with a framework: [`examples/helpdesk-agent`](../../examples/helpdesk-agent/) in LangChain and in Strands, improved once by hone's own model and once by Codex writing change files. Report: [`docs/benchmarks/custom-agents.md`](../../docs/benchmarks/custom-agents.md).

- `project.sh <langchain|strands> <dir>`: a stand-alone copy of the example with one framework, hone installed from a packed tarball and the skill in place.
- `model.sh <project> <out>`: `hone sharpen`, hone's model writing the rewrites.
- `codex.sh <project> <out>`: one isolated, sandboxed Codex session; `hone-mcp.sh` is the MCP server it talks to, which holds the API key and only judges.
- `summarize.py <project>`: every candidate, the verdicts, the held-out result by rule, and what was spent.
- `results/<framework>-<arm>/`: accounts, ledgers (`<id>.json`), diagnosis pages, the Codex event logs and the change files Codex wrote.
