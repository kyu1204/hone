# Releasing

A release is the merge of a pull request from a `release/vX.Y.Z` branch. `.github/workflows/release.yml` then runs the checks, compiles six binaries, publishes to npm with provenance, and creates tag `vX.Y.Z` with the GitHub Release. No long-lived secrets are involved.

## Steps

1. `git checkout -b release/v0.2.0`, set `package.json` `version` to `0.2.0` and add a `## 0.2.0 (YYYY-MM-DD)` section to `CHANGELOG.md`.
2. `bun run release:check v0.2.0` (version is semver and matches the branch, the CHANGELOG section exists, the tree is clean).
3. Open the pull request and merge it. Nothing else: the merge is the release.
4. Watch the `release` workflow: `check` -> `binaries` (matrix) -> `publish` -> `release`.
5. Verify: `npm view hone-eval version`, the GitHub Release has `hone-<version>-<platform>` for linux-x64, linux-x64-musl, linux-arm64, darwin-x64, darwin-arm64, windows-x64 plus `SHA256SUMS`.

A release that stopped halfway is finished with `gh workflow run release.yml -f tag=v0.2.0` once the tag exists: a version already on npm is not published again, and a Release that exists gets its binaries uploaded.

## One-time setup (maintainer, on npmjs.com)

The `publish` job uses npm trusted publishing: in the `hone-eval` package settings, add a trusted publisher for `kyu1204/hone` with workflow `release.yml`. Until that link exists `npm publish --provenance` fails and the workflow stops before the GitHub Release; the binaries are still available as workflow artifacts.

## Binaries

`bun run build:binaries [--only bun-darwin-arm64] [--out dist/bin]` compiles standalone executables with `bun build --compile` (around 85 MB each; the Bun runtime is embedded) and writes `SHA256SUMS`. The CLI, store, scorers and servers are verified in the compiled binary; the TUI depends on OpenTUI's native library, so run `hone` once after downloading a binary and fall back to `bunx hone-eval` if the dashboard does not start on your platform.

## npm package

`bun run build` bundles `src/cli.ts` to `dist/cli.js` (the `hone` bin). The package ships `dist`, `docs`, `skills`, `README.md`, `LICENSE` and `NOTICE` (`files` in `package.json`).
