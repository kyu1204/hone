# Repository hardening

Policy for a solo-maintained public repository, checked by `bun scripts/check-hardening.ts` against the live settings (needs `gh` logged in).

## Branch protection (ruleset `protect-main`, id 24883729)

- Applies to the default branch, enforcement active.
- Deletion and force pushes blocked.
- Pull request required; merge methods rebase and squash only; no approvals required (solo maintainer), extra approval for unattributed changes.
- Status check `check` (the `ci` workflow) required, strict: branches must be up to date with `main` before merging.

The ruleset JSON as recorded is `test/fixtures/ruleset.protect-main.json`; the checker's test runs against it.

## Repository settings

- Delete head branches on merge.
- Wiki and Projects disabled.
- Secret scanning and push protection enabled; vulnerability alerts and Dependabot security updates enabled.

## Workflows

- `ci.yml` and `release.yml` run with `permissions: contents: read` at the top level; only the jobs that need more ask for it (`id-token: write` for npm provenance, `contents: write` for the GitHub Release).
- Third-party actions are pinned to full commit SHAs with the tag in a comment; Dependabot (`.github/dependabot.yml`) updates them weekly along with npm minor and patch versions.
- Superseded pull request runs are cancelled (`concurrency`).

## Files

`SECURITY.md` (private vulnerability reporting), `.github/CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/{bug,feature}.yml`.

## Last check

```
kyu1204/hone (2026-10-12)
ok    ruleset active on the default branch               active on ~DEFAULT_BRANCH
ok    deletion blocked                                   yes
ok    force push blocked                                 yes
ok    pull request required, rebase/squash only          rebase,squash
ok    status check `check` required with strict updates  check strict=true
ok    delete branch on merge                             true
ok    wiki disabled                                      false
ok    projects disabled                                  false
ok    secret scanning                                    enabled
ok    push protection                                    enabled
ok    dependabot security updates                        enabled
```
