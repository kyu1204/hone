import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { binaryName, parseArgs, sha256sums, TARGETS } from "./build-binaries";

describe("build-binaries", () => {
  test("six targets, names carry version and platform, windows gets .exe", () => {
    expect(TARGETS).toHaveLength(6);
    expect(binaryName("bun-darwin-arm64", "0.1.0")).toBe("hone-0.1.0-darwin-arm64");
    expect(binaryName("bun-windows-x64", "0.1.0")).toBe("hone-0.1.0-windows-x64.exe");
    expect(binaryName("bun-linux-x64-musl", "0.1.0")).toBe("hone-0.1.0-linux-x64-musl");
  });
  test("--only limits the targets; unknown targets are rejected", () => {
    expect(parseArgs([]).only).toEqual([...TARGETS]);
    expect(parseArgs(["--only", "bun-linux-arm64", "--out", "x"])).toEqual({ only: ["bun-linux-arm64"], out: "x" });
    expect(() => parseArgs(["--only", "bun-plan9"])).toThrow(/unknown target/);
  });
  test("SHA256SUMS format", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hone-sums-"));
    fs.writeFileSync(path.join(dir, "a"), "hello");
    expect(sha256sums(dir, ["a"])).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  a\n");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
