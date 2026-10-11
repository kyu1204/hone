import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { brokenLinks, markdownFiles } from "./check-links";

const root = new URL("..", import.meta.url).pathname;

test("every relative Markdown link in the repo resolves", () => {
  expect(brokenLinks(root)).toEqual([]);
  expect(markdownFiles(root).some((f) => f.endsWith("docs/cli.md"))).toBe(true);
});

test("a broken link is reported with its file; code blocks and external links are ignored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-links-"));
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "README.md"), "[ok](./docs/a.md) [bad](./docs/missing.md) [web](https://x.y) [anchor](#top)\n```\n[in code](./nope.md)\n```\n");
  fs.writeFileSync(path.join(dir, "docs", "a.md"), "[up](../README.md#quick-start)\n");
  expect(brokenLinks(dir)).toEqual([{ file: "README.md", link: "./docs/missing.md" }]);
  fs.rmSync(dir, { recursive: true, force: true });
});
