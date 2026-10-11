// A 60-line stdio MCP server with two tools, used as the target of this example.
const TOOLS = [
  { name: "add", description: "Add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
  { name: "lookup", description: "Look up a country's capital", inputSchema: { type: "object", properties: { country: { type: "string" } }, required: ["country"] } },
];
const CAPITALS: Record<string, string> = { france: "Paris", japan: "Tokyo", kenya: "Nairobi" };

function call(name: string, args: Record<string, unknown>): { content: { type: "text"; text: string }[]; isError?: boolean } {
  if (name === "add") return { content: [{ type: "text", text: JSON.stringify({ sum: Number(args.a) + Number(args.b) }) }] };
  if (name === "lookup") {
    const capital = CAPITALS[String(args.country).toLowerCase()];
    return capital ? { content: [{ type: "text", text: JSON.stringify({ capital }) }] } : { content: [{ type: "text", text: `unknown country ${String(args.country)}` }], isError: true };
  }
  return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
}

const reader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();
let buf = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let nl = buf.indexOf("\n");
  while (nl !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    nl = buf.indexOf("\n");
    if (!line) continue;
    const req = JSON.parse(line) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    if (req.id === undefined) continue;
    let result: unknown;
    if (req.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "example", version: "0.1.0" } };
    else if (req.method === "tools/list") result = { tools: TOOLS };
    else if (req.method === "tools/call") result = call(req.params?.name ?? "", req.params?.arguments ?? {});
    else if (req.method === "ping") result = {};
    else {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found" } })}\n`);
      continue;
    }
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, result })}\n`);
  }
}
