// A stand-in coding agent: edits the workspace and prints a hone-shaped JSON result.
import * as fs from "node:fs";
const prompt = process.argv[2] ?? "";
fs.writeFileSync("greeting.txt", "hello\n");
console.log(
  JSON.stringify({
    output: `done: ${prompt}`,
    messages: [{ role: "assistant", content: `done: ${prompt}` }],
    usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.002 },
  }),
);
