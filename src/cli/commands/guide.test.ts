import { describe, expect, test } from "bun:test";
import { guideCommand } from "./guide";
import type { CommandIo } from "./run";

function io(): CommandIo & { out: string; err: string } {
  const o = { out: "", err: "", cwd: process.cwd(), env: {}, stdout: (s: string) => void (o.out += s), stderr: (s: string) => void (o.err += s) };
  return o;
}

describe("hone guide", () => {
  test("alone prints the skill; with a topic, that reference", async () => {
    const all = io();
    expect(await guideCommand([], all)).toBe(0);
    expect(all.out).toMatch(/^---\nname: hone\n/);
    expect(all.out).toContain("## Start here: pick the reference for the job");
    const one = io();
    expect(await guideCommand(["sharpening"], one)).toBe(0);
    expect(one.out).toMatch(/^# sharpening: making the system better, with proof\n/);
  });

  test("an unknown topic exits 2 and lists the topics; --help prints usage", async () => {
    const bad = io();
    expect(await guideCommand(["nope"], bad)).toBe(2);
    expect(bad.err).toMatch(/unknown topic "nope"\. Topics: setup, cases, sharpening, results, steps, mcp/);
    const help = io();
    expect(await guideCommand(["--help"], help)).toBe(0);
    expect(help.out).toMatch(/^usage: hone guide \[topic\]/);
  });
});
