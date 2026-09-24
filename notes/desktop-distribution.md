# Desktop distribution

## Supported release

Desktop releases publish independently from the `overmux` npm package. Each `desktop-v*` release contains:

```text
Overmux-Desktop-<version>-linux-x64.AppImage
overmux-desktop_<version>_amd64.deb
Overmux-Desktop-<version>-mac-arm64.zip
Overmux-Desktop-<version>-mac-x64.zip
SHA256SUMS
```

Linux x86_64 remains the supported desktop distribution. The macOS arm64 and x64 ZIPs are **experimental unsigned, non-notarized previews**. macOS cannot verify their publisher, and compatibility is not guaranteed. A DMG will not be published until Apple Developer ID signing and notarization exist.

The Electron application is only a secure desktop shell and the Electron runtime. It does not contain the Overmux server or a standalone Node.js runtime. Install and run the independently versioned `overmux` npm package, then select that server in the desktop application.

A Nix desktop artifact, Windows releases, cryptographic manifest signing, and automatic updates remain outside this release slice.

## Packaging boundary

`apps/desktop/package.json` owns the electron-builder configuration. Stable metadata includes the `com.overmux.desktop` application ID, `Overmux` product name, `overmux-desktop` Linux executable and Debian package names, desktop categories, project URL, maintainer, and `overmux:` protocol registration.

Only these application-owned files enter `app.asar`:

```text
dist/config/index.js
dist/main/**/*.js
dist/main/**/*.cjs
dist/renderer/**/*
package.json
LICENSE
dist/THIRD_PARTY_NOTICES.md
```

Electron-builder adds the production `jiti` dependency. Source TypeScript, tests, workspace development dependencies, local configuration, the Overmux server, and a standalone Node runtime are excluded.

Production packaging flips Electron fuses before any future signing boundary. `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, Node inspector arguments, and the unused browser-specific V8 snapshot are disabled. Cookie encryption, embedded ASAR integrity metadata, loading only from `app.asar`, and WebAssembly trap handlers are enabled. Extra `file:` protocol privileges remain enabled because the trusted shell is loaded with Electron's `loadFile`; remote server content remains isolated in its sandboxed HTTP(S) view. The artifact verifier reads the packaged executable's fuse wire rather than trusting configuration alone.

### Branding and licenses

The repository has no approved source artwork suitable for generating the required platform icon sizes. Packages therefore intentionally use electron-builder's fallback Electron icon. Do not invent or upscale an icon for release. Add approved vector or high-resolution source artwork under `apps/desktop/build/` and configure it before treating desktop branding as complete. This does not block the experimental macOS preview.

Original Overmux code is MIT licensed. Desktop metadata declares `MIT`, and `app.asar` includes the Overmux license and notices for bundled application dependencies. Electron's own license and Chromium third-party notices must remain in the platform distribution; the artifact verifier checks their presence. The production `jiti` package retains its own license. Review these notices when updating bundled dependencies.

## Local build and verification

On Linux x86_64:

```sh
pnpm --filter @overmux/desktop package:linux
node apps/desktop/scripts/desktop-release.ts verify linux-x64
xvfb-run --auto-servernum node apps/desktop/scripts/desktop-release.ts smoke linux-x64
```

On an arm64 or x64 Mac, replace `<arch>` with the current architecture:

```sh
pnpm --filter @overmux/desktop package:mac:<arch>
node apps/desktop/scripts/desktop-release.ts verify mac-<arch>
node apps/desktop/scripts/desktop-release.ts smoke mac-<arch>
```

The Linux verifier checks artifact names and non-empty files, Debian package and desktop-entry metadata, the absence of auto-update metadata, required and forbidden `app.asar` entries, identical application archives across the AppImage and Debian package, and production fuse states. The Xvfb smoke test launches the packaged AppImage without credentials and waits for the trusted shell to become ready.

Each macOS verifier checks the architecture-specific ZIP, bundle identity and metadata, required and forbidden `app.asar` entries, the absence of auto-update metadata, and production fuse states. The smoke test extracts the ZIP, applies an ad-hoc signature if macOS requires one, launches its executable without credentials, and waits for the trusted shell to become ready. Ad-hoc signing identifies no trusted publisher and is not Developer ID signing or notarization.

`checksums` is an aggregation command. It succeeds only when all four expected artifacts are present, then writes one `SHA256SUMS`:

```sh
node apps/desktop/scripts/desktop-release.ts checksums
(cd apps/desktop/release && sha256sum --check SHA256SUMS)
```

## Installation and operation

First install and start the independently versioned server using the instructions for the `overmux` npm package. The server currently requires Node.js 24.20 or newer.

### macOS preview

On macOS arm64 or x64, the CLI installs only to `~/Applications/Overmux.app`:

```sh
overmux desktop install
overmux desktop upgrade
```

The first install explains that the application is unsigned and non-notarized and requires interactive confirmation. For reviewed automation, `overmux desktop install --yes` accepts that warning without a prompt. `install` refuses to overwrite an existing bundle and directs the user to `upgrade`. `upgrade` requires an existing `com.overmux.desktop` bundle and verifies its identity before replacement.

Both commands select the newest published, non-draft, non-prerelease `desktop-v*` release with an artifact for the Mac's architecture. Assets are accepted only from the fixed `richardgill/overmux` GitHub repository over HTTPS. The CLI verifies GitHub's asset size and the release's `SHA256SUMS`, rejects unsafe ZIP paths, verifies the staged bundle identity, applies an ad-hoc signature if needed, removes quarantine only from that verified staged bundle, and atomically installs it without `sudo`. Install launches the app. Upgrade asks a running app to quit, also handles an app that is not running, relaunches the replacement, and restores the previous bundle when replacement or launch fails where practical.

Checksums protect against accidental corruption and provide no independent publisher authentication because they are hosted with the artifacts. This experimental slice deliberately has no signed manifest.

### Linux

For the AppImage:

```sh
chmod +x Overmux-Desktop-<version>-linux-x64.AppImage
./Overmux-Desktop-<version>-linux-x64.AppImage
```

For Debian and Ubuntu:

```sh
sudo apt install ./overmux-desktop_<version>_amd64.deb
overmux-desktop
```

The desktop app restores its saved server URL or prompts for one. `OVERMUX_SERVER_URL=http://127.0.0.1:4242 overmux-desktop` selects a server explicitly.

To upgrade Linux manually, verify `SHA256SUMS`, then replace the AppImage or install the newer Debian package with the same commands. To uninstall, remove the AppImage or run `sudo apt remove overmux-desktop`. User configuration remains under `$XDG_CONFIG_HOME/overmux` and Electron browser data remains in its standard per-user application data directory unless removed manually.

There is deliberately no auto-updater.

## Release automation

The desktop version in `apps/desktop/package.json` is independent from npm package versions. The package remains `private: true` and is never published to npm. Changesets versions private packages and generates their changelogs; its private-package tagging is disabled because desktop owns the `desktop-v<version>` namespace.

1. Run `pnpm changeset` in a desktop PR and select `@overmux/desktop`. Include packaging and release-workflow changes, not just application source. The Changesets check requires a newly added changeset; an existing pending changeset does not cover a new PR. Use `pnpm changeset --empty` with a reason when no release is needed. Unrelated private workspaces do not require their own releases.
2. Merge the PR. After successful main CI, the existing Changesets release PR includes the desktop version bump and `apps/desktop/CHANGELOG.md` entry alongside any independent npm releases. The automated `changeset-release/main` PR is exempt from changeset coverage checks.
3. Merge the release PR. After successful main CI and with no pending changesets, `.github/workflows/release.yml` attempts npm publication and independently detects whether the desktop version needs releasing. It directly calls the reusable `.github/workflows/desktop-release.yml`; pushing a tag is no longer the release trigger.

Stale CI completion events are skipped: the triggering commit must match the Release workflow's main snapshot because Changesets resets its release-PR branch to that snapshot. Newer main commits must pass their own CI before release automation proceeds.

Desktop source is pinned to the first main commit introducing that version, following Git's first-parent history (the main side of merges). That exact commit must have successful main CI and the matching changelog entry. If its CI was cancelled by a newer main push, rerun that commit's CI before retrying Release. Detection, tagging, native builds, and publication all use this commit, not a moving `main` or tag checkout. A preparation job creates the matching tag without force; a tag pointing elsewhere fails and is never moved.

Read-only Linux x64, macOS arm64, and macOS x64 jobs independently validate the source, build their artifacts, verify package contents and fuses, smoke-test the packaged application, and upload workflow artifacts. The final job depends on every platform job. It downloads all verified outputs, requires the exact four-artifact set, generates one `SHA256SUMS`, creates or reuses a draft GitHub Release, uploads every asset, and publishes only after every upload succeeds. Notes use only that desktop version's changelog entry and retain the unsigned, non-notarized macOS preview warning. Only preparation and publication have content write permission.

A failed build, verification, smoke test, aggregation, or upload leaves no new public release. An incomplete release remains a draft. Rerun the failed Release workflow, or dispatch Release on main after its CI succeeds. Later main pushes also retry missing/draft releases from the original version commit, including when an earlier attempt never created a tag. Public versions are skipped before tag/history checks and never edited. If the release source itself needs a fix, add a new desktop changeset and release a new version rather than retargeting the old one.

Release runs are serialized without cancelling active publication, and desktop attempts also share a per-version lock. The workflows use only the repository-provided GitHub token; tag pushes with that token do not trigger push workflows, which is why the desktop workflow is called directly. No packaging credentials or repository-setting changes are needed by this automation. Configure the `Changesets` PR check as required in branch protection when the repository plan supports it.
