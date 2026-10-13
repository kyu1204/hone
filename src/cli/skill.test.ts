import { expect, test } from "bun:test";
import { commandNames } from "../cli";
import { SKILL_FILES, TOPICS } from "./skill";

test("every reference the skill routes to exists, and every topic has a row", () => {
  const skill = SKILL_FILES["SKILL.md"]!;
  const linked = [...skill.matchAll(/\]\((references\/[a-z-]+\.md)\)/g)].map((m) => m[1]!);
  expect(linked.sort()).toEqual(TOPICS.map((t) => `references/${t}.md`).sort());
  for (const f of linked) expect(SKILL_FILES[f]).toBeDefined();
  for (const t of TOPICS) expect(skill).toContain(`| \`${t}\` |`);
  expect(Object.keys(SKILL_FILES).sort()).toEqual(["SKILL.md", ...TOPICS.map((t) => `references/${t}.md`)].sort());
});

test("every hone command a skill file mentions is a real command", () => {
  const known = new Set([...commandNames(), "help"]);
  const used = new Set<string>();
  for (const text of Object.values(SKILL_FILES)) {
    // commands appear in inline code and at the start of a line in a code block; "hone runs every case" in prose is not one
    for (const m of text.matchAll(/`hone ([a-z][a-z-]*)/g)) used.add(m[1]!);
    for (const block of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) for (const m of block[1]!.matchAll(/^hone ([a-z][a-z-]*)/gm)) used.add(m[1]!);
  }
  expect([...used].filter((c) => !known.has(c))).toEqual([]);
  for (const c of ["init", "test", "sharpen", "guide", "compare", "calibrate"]) expect(used.has(c)).toBe(true);
});
