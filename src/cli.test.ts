import { expect, test } from "bun:test";

const cli = new URL("./cli.ts", import.meta.url).pathname;

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", cli, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

test("--version prints the package version", async () => {
  const { code, stdout } = await run(["--version"]);
  expect(code).toBe(0);
  expect(stdout).toMatch(/^hone \d+\.\d+\.\d+/);
});

test("no arguments prints a one-line usage", async () => {
  const { code, stdout } = await run([]);
  expect(code).toBe(0);
  expect(stdout.trim().split("\n")).toHaveLength(1);
  expect(stdout).toContain("hone");
});
