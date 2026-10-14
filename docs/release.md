# Releasing

Releases are cut from `main` by pushing a `vX.Y.Z` tag. `.github/workflows/release.yml` then runs the checks, compiles six binaries, publishes to npm with provenance, and creates the GitHub Release. No long-lived secrets are involved.

## Steps

1. Update `package.json` `version` and add a `## X.Y.Z (YYYY-MM-DD)` section to `CHANGELOG.md`.
2. `bun run release:check` (version is semver, the CHANGELOG section exists, the tree is clean). With a tag argument it also checks the tag matches: `bun run release:check v0.1.0`.
3. Merge that change to `main` through a pull request like any other.
4. `git tag v0.1.0 && git push origin v0.1.0`.
5. Watch the `release` workflow: `check` -> `binaries` (matrix) -> `publish` -> `release`.
6. Verify: `npm view honed version`, the GitHub Release has `hone-<version>-<platform>` for linux-x64, linux-x64-musl, linux-arm64, darwin-x64, darwin-arm64, windows-x64 plus `SHA256SUMS`.

## One-time setup (maintainer, in the npm UI)

The `publish` job uses npm trusted publishing: on npmjs.com, open the `honed` package settings, add a trusted publisher for `kyu1204/hone` with workflow `release.yml`, and enable "require two-factor authentication or an automation token" to be bypassed by trusted publishers. Until that link exists `bun publish --provenance` fails and the workflow stops before the GitHub Release; the binaries are still available as workflow artifacts.

## Binaries

`bun run build:binaries [--only bun-darwin-arm64] [--out dist/bin]` compiles standalone executables with `bun build --compile` (around 85 MB each; the Bun runtime is embedded) and writes `SHA256SUMS`. The CLI, store, scorers and servers are verified in the compiled binary; the TUI depends on OpenTUI's native library, so run `hone` once after downloading a binary and fall back to `bunx honed` if the dashboard does not start on your platform.

## npm package

`bun run build` bundles `src/cli.ts` to `dist/cli.js` (the `hone` bin). The package ships `dist`, `docs`, `skills`, `README.md`, `LICENSE` and `NOTICE` (`files` in `package.json`).
