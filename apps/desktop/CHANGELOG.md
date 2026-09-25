# @overmux/desktop

## 0.0.6

### Patch Changes

- [#15](https://github.com/richardgill/overmux/pull/15) [`ab776b6`](https://github.com/richardgill/overmux/commit/ab776b659a54877a82af52d2150c14942457839c) Thanks [@richardgill](https://github.com/richardgill)! - Use Zod 4.6.5 throughout the workspace and rebuild dependent packages. Packages exposing Zod schemas now share the application's installation through a ^4.6.5 peer dependency so public schemas remain type-compatible. Newly initialized applications explicitly depend on Zod ^4.6.5.

## 0.0.5

### Patch Changes

- [#9](https://github.com/richardgill/overmux/pull/9) [`664a302`](https://github.com/richardgill/overmux/commit/664a3023f9c452f737b3430f3d93be4bcd8841e1) Thanks [@richardgill](https://github.com/richardgill)! - Rebuild the desktop release with corrected macOS keyboard test configuration, preserving production Option-key behavior.

## 0.0.4

### Patch Changes

- [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0) Thanks [@richardgill](https://github.com/richardgill)! - Declare MIT licensing for original Overmux code, include distribution licenses and third-party notices, and establish current-version changelog baselines for public source releases.

## 0.0.3

Current-version baseline: secure Electron desktop host for an independently running Overmux server, distributed for Linux x86_64 and as experimental unsigned macOS previews.
