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

const rows = (text: string): string[] => text.split("\n").filter((l) => /^  \S/.test(l)).map((l) => l.trim().split(/\s+/)[0]!);

test("no arguments prints the everyday commands and nothing else", async () => {
  const { code, stdout } = await run([]);
  expect(code).toBe(0);
  expect(rows(stdout)).toEqual(["init", "test"]);
  expect(stdout).toContain("hone help all");
  const help = await run(["help"]);
  expect(help.stdout).toBe(stdout);
});

test("hone help all lists every other command in groups, in plain words", async () => {
  const { code, stdout } = await run(["help", "all"]);
  expect(code).toBe(0);
  expect(rows(stdout)).toEqual(["init", "test", "cluster", "calibrate", "evolve", "optimize", "ablate", "compare", "power", "tui", "matrix", "explain", "diff", "fork", "bisect", "export", "import", "serve"]);
  expect(stdout).not.toMatch(/Thompson|Pareto/);
});

test("run, ci and report are gone; test takes their place, with --ci and --report", async () => {
  for (const old of ["run", "ci", "report"]) {
    const r = await run([old]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`unknown command "${old}"`);
  }
  const help = await run(["test", "--help"]);
  expect(help.code).toBe(0);
  expect(help.stdout).toMatch(/^usage: hone test/);
  expect(help.stdout).toMatch(/--adaptive/);
  expect(help.stdout).toMatch(/--report/);
  const ci = await run(["test", "--ci", "--help"]);
  expect(ci.code).toBe(0);
  expect(ci.stdout).toMatch(/^usage: hone test --ci/);
  expect(ci.stdout).toMatch(/--min-pass-at-1/);
});

test("unknown commands exit 2 with the short usage on stderr", async () => {
  const bad = await run(["nope"]);
  expect(bad.code).toBe(2);
  expect(bad.stderr).toMatch(/unknown command "nope"/);
  expect(rows(bad.stderr)).toEqual(["init", "test"]);
});
