# mcp: hone over the MCP server

`hone init` registers the server as `hone` in `.mcp.json` (Claude Code) and `.cursor/mcp.json`. By hand:

```bash
claude mcp add hone -- bunx honed serve mcp
```

The server runs in the project directory and returns what the CLI prints with `--json`. Started as `hone serve mcp --no-rewrites`, its `hone_sharpen` never lets hone's own model write a rewrite: what you propose is what gets judged. With a shell, the CLI and the files it writes are the simpler route; the server is for clients without one.

| Tool | Does |
| --- | --- |
| `hone_test` | runs the cases (optionally some `cases`, `targets`, `trials`) and returns the run summary |
| `hone_sharpen` | runs the cycle (`budget`, `until`, `maxCost`, `trials`, `rewrites: false` to have only your own changes judged) and returns the result document: split, diagnosis, every candidate, verdict, and the account as `message` |
| `hone_guide` | returns this skill, or one topic of it |
| `hone_list_runs`, `hone_matrix`, `hone_compare`, `hone_explain`, `hone_cluster`, `hone_fork` | the single steps (topic `steps`) |

A change is still a file under `sharpen/`: write it with your file tools, then call `hone_sharpen`. `hone_sharpen` with `budget: 0` diagnoses only; read the page named in `diagnosisPath`.
