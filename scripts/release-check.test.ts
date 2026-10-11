import { describe, expect, test } from "bun:test";
import { releaseProblems } from "./release-check";

const ok = { version: "0.1.0", tag: "v0.1.0", changelog: "# Changelog\n\n## 0.1.0 (2026-10-12)\n\n- first\n", gitStatus: "" };

describe("release-check", () => {
  test("a matching tag, changelog section and clean tree pass", () => {
    expect(releaseProblems(ok)).toEqual([]);
    expect(releaseProblems({ ...ok, tag: undefined })).toEqual([]);
    expect(releaseProblems({ ...ok, changelog: "## [0.1.0] - 2026-10-12\n" })).toEqual([]);
  });
  test("each problem is named", () => {
    expect(releaseProblems({ ...ok, tag: "v0.2.0" })).toEqual([expect.stringMatching(/tag v0\.2\.0 does not match/)]);
    expect(releaseProblems({ ...ok, changelog: "## Unreleased\n" })).toEqual([expect.stringMatching(/no "## 0\.1\.0" section/)]);
    expect(releaseProblems({ ...ok, gitStatus: " M README.md\n" })).toEqual([expect.stringMatching(/not clean/)]);
    expect(releaseProblems({ ...ok, version: "banana" })).toEqual([expect.stringMatching(/not semver/), expect.stringMatching(/does not match/), expect.stringMatching(/no "## banana"/)]);
  });
});
