// Resolves every relative Markdown link in README.md, docs/**, examples/**/README.md and skills/** to a file on disk.
import * as fs from "node:fs";
import * as path from "node:path";

export function markdownFiles(root: string): string[] {
  const out: string[] = ["README.md", "CONTRIBUTING.md"].filter((f) => fs.existsSync(path.join(root, f))).map((f) => path.join(root, f));
  const walk = (dir: string): void => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (f === "node_modules" || f.startsWith(".")) continue;
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".md")) out.push(p);
    }
  };
  for (const d of ["docs", "examples", "skills"]) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
  return out.sort();
}

const LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function brokenLinks(root: string): { file: string; link: string }[] {
  const broken: { file: string; link: string }[] = [];
  for (const file of markdownFiles(root)) {
    const text = fs.readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    for (const m of text.matchAll(LINK)) {
      const link = m[1]!;
      if (/^(https?:|mailto:|#)/.test(link)) continue;
      const target = link.split("#")[0]!;
      if (!target) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), target))) broken.push({ file: path.relative(root, file), link });
    }
  }
  return broken;
}

if (import.meta.main) {
  const broken = brokenLinks(new URL("..", import.meta.url).pathname);
  for (const b of broken) console.log(`${b.file}: ${b.link}`);
  console.log(broken.length ? `${broken.length} broken link(s)` : "all relative links resolve");
  process.exit(broken.length ? 1 : 0);
}
