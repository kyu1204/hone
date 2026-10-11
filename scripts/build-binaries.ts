// Compiles standalone hone binaries for every supported platform: bun scripts/build-binaries.ts [--only <target>] [--out dist/bin]
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import pkg from "../package.json" with { type: "json" };

export const TARGETS = ["bun-linux-x64", "bun-linux-x64-musl", "bun-linux-arm64", "bun-darwin-x64", "bun-darwin-arm64", "bun-windows-x64"] as const;
export type BuildTarget = (typeof TARGETS)[number];

export function binaryName(target: string, version = pkg.version): string {
  return `hone-${version}-${target.replace(/^bun-/, "")}${target.includes("windows") ? ".exe" : ""}`;
}

export function parseArgs(argv: string[]): { only: BuildTarget[]; out: string } {
  const only: BuildTarget[] = [];
  let out = "dist/bin";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") {
      const t = argv[++i];
      if (!TARGETS.includes(t as BuildTarget)) throw new Error(`unknown target ${t}; known: ${TARGETS.join(", ")}`);
      only.push(t as BuildTarget);
    } else if (argv[i] === "--out") out = argv[++i] ?? out;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return { only: only.length ? only : [...TARGETS], out };
}

export function sha256sums(dir: string, files: string[]): string {
  return `${files.map((f) => `${createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex")}  ${f}`).join("\n")}\n`;
}

export async function buildBinaries(opts: { only: BuildTarget[]; out: string; root?: string; log?: (s: string) => void }): Promise<string[]> {
  const root = opts.root ?? new URL("..", import.meta.url).pathname;
  const outDir = path.resolve(root, opts.out);
  fs.mkdirSync(outDir, { recursive: true });
  const built: string[] = [];
  for (const target of opts.only) {
    const name = binaryName(target);
    const outfile = path.join(outDir, name);
    opts.log?.(`building ${name}`);
    const proc = Bun.spawn(["bun", "build", "src/cli.ts", "--compile", `--target=${target}`, "--outfile", outfile], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) throw new Error(`bun build failed for ${target}: ${err.trim().slice(-800)}`);
    built.push(name);
  }
  fs.writeFileSync(path.join(outDir, "SHA256SUMS"), sha256sums(outDir, built));
  return built;
}

if (import.meta.main) {
  const opts = parseArgs(process.argv.slice(2));
  const built = await buildBinaries({ ...opts, log: console.log });
  console.log(`built ${built.length} binar${built.length === 1 ? "y" : "ies"} in ${opts.out}; SHA256SUMS written`);
}
