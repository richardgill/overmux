---
title: "`overmux desktop`"
---

Install or upgrade the experimental macOS desktop preview. The desktop version is independent from the `overmux` npm package version.

## Install

```sh
overmux desktop install
```

This command is available only on macOS arm64 and x64. It selects the newest stable `desktop-v*` GitHub release supporting the current architecture and installs it only at `~/Applications/Overmux.app`. It refuses to overwrite an existing bundle; use `upgrade` instead.

The macOS application is an **experimental unsigned, non-notarized preview**. macOS cannot verify its publisher, compatibility is not guaranteed, and no DMG is published. First install requires interactive confirmation:

```sh
overmux desktop install --yes
```

Use `--yes` only when automation has explicitly accepted the unsigned application risk.

## Upgrade

```sh
overmux desktop upgrade
```

Upgrade verifies that the existing app has the `com.overmux.desktop` bundle identity before replacing it. A running app is asked to quit; an app that is not running is upgraded normally. The new app is launched, and the previous bundle is restored when replacement or launch fails where practical.

Both commands accept release assets only from the fixed official GitHub repository over HTTPS, verify asset size and `SHA256SUMS`, reject unsafe ZIP paths, validate the staged bundle, ad-hoc sign it if needed, and remove quarantine only from that bundle. They never use `sudo` or write to `/Applications`.

Checksums detect accidental corruption but are not independent publisher authentication because they are hosted with the artifacts. There is no cryptographically signed release manifest in this experimental distribution.
