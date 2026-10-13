import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { renderCliDocs } from "./gen-cli-docs";

test("docs/cli.md is current (run `bun scripts/gen-cli-docs.ts` after changing a usage string)", () => {
  const file = new URL("../docs/cli.md", import.meta.url).pathname;
  expect(fs.readFileSync(file, "utf8")).toBe(renderCliDocs());
});

test("every command section is present", () => {
  const md = renderCliDocs();
  for (const c of ["init", "test", "test --ci", "cluster", "calibrate", "evolve", "optimize", "ablate", "compare", "power", "tui", "matrix", "explain", "diff", "fork", "bisect", "export", "import", "serve"]) expect(md).toContain(`### hone ${c}\n`);
  for (const gone of ["run", "ci", "report"]) expect(md).not.toContain(`### hone ${gone}\n`);
});
