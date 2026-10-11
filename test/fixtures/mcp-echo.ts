// Minimal stdio MCP server for tests: tools `echo`, `structured`, `fail`, `crash`.
// Newline-delimited JSON-RPC 2.0 on stdin/stdout.
const tools = [
  { name: "echo", description: "Echo the text argument", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "structured", description: "Return structured content", inputSchema: { type: "object" } },
  { name: "fail", description: "Return an error result", inputSchema: { type: "object" } },
  { name: "crash", description: "Exit the process", inputSchema: { type: "object" } },
];
const write = (obj: unknown) => process.stdout.write(`${JSON.stringify(obj)}\n`);
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const req = JSON.parse(line) as { id?: number; method: string; params?: Record<string, unknown> };
    if (req.method === "initialize") {
      write({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mcp-echo", version: "0.1.0" } } });
    } else if (req.method === "notifications/initialized") {
      // nothing
    } else if (req.method === "tools/list") {
      write({ jsonrpc: "2.0", id: req.id, result: { tools } });
    } else if (req.method === "tools/call") {
      const { name, arguments: args } = req.params as { name: string; arguments: Record<string, unknown> };
      if (name === "echo") write({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: String(args.text ?? "") }] } });
      else if (name === "structured") write({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "{\"n\":1}" }], structuredContent: { n: 1, args } } });
      else if (name === "fail") write({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "tool failed badly" }], isError: true } });
      else if (name === "crash") process.exit(7);
      else write({ jsonrpc: "2.0", id: req.id, error: { code: -32602, message: `unknown tool ${name}` } });
    } else if (req.id !== undefined) {
      write({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found" } });
    }
  }
});
