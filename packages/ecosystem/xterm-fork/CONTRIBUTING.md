# Contributing and releasing

Private build recipe for the **public** npm package `@overmux/xterm-fork`.
[Recipe and verification details](FORK.md) describe the pinned upstream and patches.
Use Node 24.20.0 (bundles npm 11.19.0), pnpm 10.33.0, Git, and authenticated GitHub CLI (`gh`).
Run `pnpm install --frozen-lockfile` from the Overmux root first. All commands below run from `packages/ecosystem/xterm-fork/` unless noted otherwise.

## Release prerequisites

`6.0.0-overmux.1` is already published. Before a future patch release, a human must
verify or configure the npm [trusted publisher](https://docs.npmjs.com/trusted-publishers/):
GitHub owner `richardgill`, repository `overmux`, workflow
`xterm-fork-release.yml`, with no GitHub environment. Current configuration is not
verified by this repository. The GitHub repository may be public or private; the
workspace recipe remains private solely to prevent npm publishing the recipe root.

The workflow authenticates with GitHub's short-lived identity credentials (OIDC), not
an npm token. npm automatically creates public provenance for trusted publishing from
a public source repository; a private source repository cannot produce public provenance.
Do not force `--provenance` or replace trusted publishing with long-lived credentials.
`pnpm release` does not configure the publisher; preserve `id-token: write` and upstream
MIT attribution.

## Normal releases

```sh
pnpm changeset                        # write a patch release note
pnpm changeset -m "Fix input handling" # noninteractive note authoring
# Commit the feature/fix and its .changeset/*.md together; start release from a clean branch.
pnpm release                          # run in an interactive terminal
```

`pnpm changeset` runs our `scripts/changeset.mts` author, which writes standard
Changesets markdown directly to this package's `.changeset/`, never the workspace
root. It uses the workspace-catalog Changesets parser; it does not require CLI 3's
`add --patch` support or run workspace discovery. The note directory needs no local
Changesets configuration; `.gitkeep` keeps it tracked when no notes are pending. Our custom
`pnpm prepare-release` handles versioning and changelog generation; `pnpm release`
orchestrates preparation and publishing. Neither uses Changesets' version/publish commands.

`pnpm release` checks the canonical repository/package identity, `origin`, clean
attached branch, pending notes, available version tag, and public npm package baseline.
An npm lookup failure stops with connectivity/trusted-publisher configuration guidance; it never falls
back to local npm publication. **Trusted publisher configuration cannot be proven
locally**; its correctness and GitHub Actions permissions remain prerequisites.

It runs existing `prepare-release`, displays the prepared diff, version, commit,
branch, tag and remote, then asks **one** approval (type `yes`). After approval:

1. Commit only `package.json`, `CHANGELOG.md` and consumed release notes.
2. Push the current branch to `origin`, create and push `xterm-fork-v<package.json version>`.
3. Dispatch `xterm-fork-release.yml` on that exact tag and watch the matching new run.
4. GitHub runs the single-build checks/tests, then publishes the verified tarball
   to public npm with `--tag latest --access public` **last**.

There is no extra local build, release PR, `--yes`, or publish trigger on tag
pushes. The workflow remains manual-dispatch-only. Do not manually
dispatch another release concurrently; ambiguous matching runs stop the watcher.

Preparation accepts only nonempty patch notes for `@overmux/xterm-fork`; no notes
means no release. Do not use standard Changesets `version` or `publish`, or edit the
version independently. `package.json` is last-prepared metadata, not registry state.
On the same `upstream.ts` base, `6.0.0-overmux.1` becomes `6.0.0-overmux.2`; an upstream
bump plus a note starts `6.0.1-overmux.1`. Invalid/stale versions are refused.
These are semver prerelease versions published under npm `latest`; consumers should
pin the complete version. A published version must never be reused.

## Workspace isolation and validation

The private recipe is a workspace build input. `@overmux/xterm` uses `workspace:*`,
which pnpm packs as the exact prepared fork version. Publish the fork before releasing
its consumers. Standard release scripts run `scripts/check-standard-release.ts` to
reject any root Changesets plan that versions the fork. Do not bypass that guard with
`pnpm exec changeset version`. Ignoring the fork in root Changesets configuration is
not viable: Changesets would require ignoring its public consumers too. Desktop's
private-package versioning remains enabled.

`test:release` owns cheap release tooling tests; `build` owns one fresh upstream build,
tarball inspection, addon/direct typechecks, UMD/ESM browser behavior and upstream tests.
Normal Turbo `^build` ordering builds and validates the fork once, then caches `dist/`
for consumers. `test` only runs release tooling tests, avoiding a second upstream build.
The fork's standalone `local-ci` runs release tests followed by the same verified
`build` command. The builder has only two modes: `build` (the default) and `pack`.
`pack:tarball` deliberately builds fresh runtime artifacts, writes `dist/` and packs
`.test-tmp/overmux-xterm-fork-<version>.tgz` **without validation** for local inspection.
It is not a release shortcut: use `local-ci` and inspect its verified tarball before
publication. Both modes remove stale outputs before starting and on failure.
Node 24 runs these TypeScript scripts without experimental flags.
No repeat-build or reproducibility check is added. Failed builds remove previous outputs
before starting. `dist/` exposes workspace runtime/types/CSS; the generated tarball
keeps upstream-style `lib/`, `typings/` and `css/` paths.

Release git checks inspect the whole repository and commit only repo-relative fork
manifest/changelog/consumed-note paths. Unrelated root changesets and versions are
never included. The workflow publishes only through the human-verified trusted
publisher configuration; do not substitute local credentials.

## Cancellation and recovery

No rollback, force push, tag replacement, or automatic retry is performed. Errors
identify the failed stage. Inspect `git status`, `git diff`, local/remote tags,
GitHub Actions and npm state before resuming; do not rerun the whole command blindly.

- **Declined prompt / failure before commit:** prepared edits remain, with no
  commit/push/tag/dispatch. Review and manually commit them, then resume below.
  Alternatively, deliberately restore only those generated paths after inspection
  to rerun preparation; there is no broad reset/clean. `pnpm release` refuses the
  dirty tree, and an already prepared release has no pending notes to prepare again.
- **Commit or branch push failed:** check whether the release commit exists first;
  commit only the reviewed manifest/changelog/consumed notes if needed. Resolve the
  push issue without force, then `git push origin HEAD:refs/heads/<release-branch>`.
- **Tag step failed:** verify the release SHA and both local/remote `xterm-fork-v<version>`.
  Create a missing local tag with `git tag xterm-fork-v<version> <release-sha>` and push a missing
  remote tag with `git push origin refs/tags/xterm-fork-v<version>`. Never delete/recreate an
  existing tag. A conflict requires investigation, not an overwrite.
- **Dispatch/watch failed:** the run may already be publishing. First inspect
  `gh run list --repo richardgill/overmux --workflow xterm-fork-release.yml --branch xterm-fork-v<version> --commit <release-sha> --event workflow_dispatch`.
  Watch the verified run with `gh run watch <id> --repo richardgill/overmux --exit-status`,
  or inspect `gh run view <id> --repo richardgill/overmux --log-failed`.
  Only if no dispatch occurred, resume with
  `gh workflow run xterm-fork-release.yml --repo richardgill/overmux --ref xterm-fork-v<version>`.
  After a failed run, check `npm view @overmux/xterm-fork@<version> version --registry=https://registry.npmjs.org`
  before deciding whether a workflow rerun is safe. If publication succeeded, never
  republish that version; a new fix needs a new note/version. Fix trusted publisher
  or workflow permissions if required, without substituting local credentials.
