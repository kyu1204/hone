# mcp-server

Evaluate an MCP server's tools without a model in the loop. `server.ts` is a stdio MCP server with `add` and `lookup`; the `mcp` target spawns it, sends `tools/call lookup` per case, and the scorers check the returned JSON (`json-schema`), the expected value (`contains`) and that the tool was actually called (`tool_used`).

```bash
cd examples/mcp-server
hone test
hone explain <trialId>   # shows the tools/call span with arguments and result
```

Point `targets.lookup.command` at your own server and `tool` at the tool under test. Each case's `input` is mapped to tool arguments by `args`.
