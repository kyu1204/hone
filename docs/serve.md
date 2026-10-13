# Serving

## `hone serve ssh`

Serves the dashboard over SSH (`@opentui/ssh`): one renderer and one store per connection, read-only by default. `--host 0.0.0.0` shares it on the network; the host key is generated once at `~/.config/hone/ssh_host_key`.

```
hone serve ssh --port 2222
ssh -p 2222 anyone@localhost
```

## `hone serve reward`

An HTTP reward API over the configured scorers (all, or `--scorer name` repeated).

| route | body | reply |
|---|---|---|
| `GET /health` | | `{ ok, scorers }` |
| `POST /score` | `{ messages?, output?, spans?, case?: { id?, input?, expected?, rubric? } }` | `{ reward, pass, scores }` |
| `POST /batch` | `{ items: [...] }` | `{ results: [...] }` in order |

`reward` is 1 or 0 by verdict and the mean score value when undecided. Malformed bodies answer 400; a scorer exception answers 500.

## `hone serve mcp`

MCP over stdio (newline-delimited JSON-RPC 2.0, protocol `2025-06-18`). Register it in an MCP client:

```json
{ "mcpServers": { "hone": { "command": "hone", "args": ["serve", "mcp"] } } }
```

| tool | arguments | returns |
|---|---|---|
| `hone_test` | `cases?, targets?, trials?` | run summary |
| `hone_sharpen` | `budget?, until?, maxCost?, trials?` | the result document of the cycle: split, diagnosis, every candidate, verdict, and the account as `message`; `budget: 0` only diagnoses |
| `hone_guide` | `topic?` | the skill for coding agents, or one topic of it |
| `hone_list_runs` | `limit?` | runs, newest first |
| `hone_matrix` | `run?` | per-target matrix |
| `hone_compare` | `a, b, run?` | paired comparison |
| `hone_explain` | `trialId` | the trial plus `forkCandidates` |
| `hone_cluster` | `run?, induce?` | clusters file |
| `hone_fork` | `trialId, step, content` | forked trial and divergence |

Each tool returns the same JSON the CLI prints with `--json`; failures come back as `isError` content, never as protocol errors.
