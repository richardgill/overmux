# @overmux/tmux

## 0.0.9

### Patch Changes

- [#19](https://github.com/richardgill/overmux/pull/19) [`e214a92`](https://github.com/richardgill/overmux/commit/e214a923d6932a2875eb1458e65083b88f7f60e8) Thanks [@richardgill](https://github.com/richardgill)! - Require tmux 3.2 or newer and report a clear error when the executable or running server is too old.

## 0.0.8

### Patch Changes

- [#15](https://github.com/richardgill/overmux/pull/15) [`ab776b6`](https://github.com/richardgill/overmux/commit/ab776b659a54877a82af52d2150c14942457839c) Thanks [@richardgill](https://github.com/richardgill)! - Use Zod 4.6.5 throughout the workspace and rebuild dependent packages. Packages exposing Zod schemas now share the application's installation through a ^4.6.5 peer dependency so public schemas remain type-compatible. Newly initialized applications explicitly depend on Zod ^4.6.5.

- [#12](https://github.com/richardgill/overmux/pull/12) [`be25599`](https://github.com/richardgill/overmux/commit/be255998a17c61a778611ab142fe09060435c9b3) Thanks [@richardgill](https://github.com/richardgill)! - Fix missing tmux sessions, windows, and panes under non-UTF-8 locales by forcing UTF-8 on the control client.

- Updated dependencies [[`a73f207`](https://github.com/richardgill/overmux/commit/a73f20729477037e0d779c181e79d04d5c55af71), [`ab776b6`](https://github.com/richardgill/overmux/commit/ab776b659a54877a82af52d2150c14942457839c)]:
  - overmux@0.0.8
  - @overmux/pty@0.0.6
  - @overmux/terminal-stream@0.0.6
  - @overmux/xterm@0.0.8

## 0.0.7

### Patch Changes

- [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0) Thanks [@richardgill](https://github.com/richardgill)! - Declare MIT licensing for original Overmux code, include distribution licenses and third-party notices, and establish current-version changelog baselines for public source releases.

- [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0) Thanks [@richardgill](https://github.com/richardgill)! - Cancel pending xterm composition internally before local navigation, on observed pane/window/session changes, and on disconnect/failure, without remounting the textarea or adding application callbacks or ref methods. Unobserved native tmux changes remain outside this local cancellation guarantee.

- [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0) Thanks [@richardgill](https://github.com/richardgill)! - Use the maintained @overmux/xterm-fork distribution with input transforms built in, removing the need for consumer-side pnpm patches.

- Updated dependencies [[`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0), [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0), [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0), [`b64425c`](https://github.com/richardgill/overmux/commit/b64425c1db101b1996390160dd9ecd934e4eba4a), [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0)]:
  - overmux@0.0.7
  - @overmux/pty@0.0.5
  - @overmux/terminal-stream@0.0.5
  - @overmux/xterm@0.0.7

## 0.0.6

Current-version baseline: tmux resources, operations, navigation, and terminal streaming for Overmux.
