// Evaluate an MCP tool directly: hone starts the server, calls tools/call per case, scores the JSON it returns.
import { defineConfig } from "../../src/index.ts"; // in your project: from "honed"

const here = new URL(".", import.meta.url).pathname;

export default defineConfig({
  targets: {
    lookup: { kind: "mcp", command: ["bun", `${here}server.ts`], tool: "lookup", args: (input: unknown) => ({ country: String(input) }), version: "example-0.1.0" },
  },
  cases: "evals/*.yaml",
  trials: 1,
  scorers: [
    { name: "json-schema", schema: { type: "object", required: ["capital"], properties: { capital: { type: "string" } } } },
    { name: "contains", caseField: "expected" },
    { name: "tool_used", tool: "lookup" },
  ],
  gates: { passAt1: { min: 1 } },
});
