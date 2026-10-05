# @overmux/tmux

## 0.0.14

### Patch Changes

- [#47](https://github.com/richardgill/overmux/pull/47) [`e4770c3`](https://github.com/richardgill/overmux/commit/e4770c38b026872a5685a03227162271361e9f0d) Thanks [@richardgill](https://github.com/richardgill)! - Discover terminal clients by their spawned PTY PID instead of a readiness handshake, preventing cancelled attachments from stranding the shared tmux command queue and stalling later navigation.

- Updated dependencies [[`1a43f1f`](https://github.com/richardgill/overmux/commit/1a43f1fa4d1925c84713963216af270b70de9639)]:
  - @overmux/xterm@0.0.13

## 0.0.13

### Patch Changes

- [#45](https://github.com/richardgill/overmux/pull/45) [`962d5aa`](https://github.com/richardgill/overmux/commit/962d5aa0f5443adc259744f8a9d04bdef6bdd460) Thanks [@richardgill](https://github.com/richardgill)! - Add bounded control-command history and correlated terminal attachment diagnostics through Overmux handler logging, without changing tmux lifecycle or recovery behavior.

- [#46](https://github.com/richardgill/overmux/pull/46) [`053f7b6`](https://github.com/richardgill/overmux/commit/053f7b6cf03050e6499905fc9d71bdf5a9894fde) Thanks [@richardgill](https://github.com/richardgill)! - Refresh explicit tmux state reads and avoid refreshing hierarchy state for stream-only notification listeners.

- Updated dependencies [[`b392280`](https://github.com/richardgill/overmux/commit/b3922800cfe31ca3d85c76fa3d364d146d96df88), [`053f7b6`](https://github.com/richardgill/overmux/commit/053f7b6cf03050e6499905fc9d71bdf5a9894fde)]:
  - overmux@0.0.12
  - @overmux/xterm@0.0.12

## 0.0.12

### Patch Changes

- Updated dependencies [[`1a8bf22`](https://github.com/richardgill/overmux/commit/1a8bf22fb787b78a0beb8212fa33b074bfb9e9e5), [`910ca21`](https://github.com/richardgill/overmux/commit/910ca216beeedeb7326baad6625452bb691fc801), [`cfc58d8`](https://github.com/richardgill/overmux/commit/cfc58d8881fa847fc15f7a5a02c2ad5e702ebe02)]:
  - overmux@0.0.11
  - @overmux/xterm@0.0.11

## 0.0.11

### Patch Changes

- [#27](https://github.com/richardgill/overmux/pull/27) [`827c701`](https://github.com/richardgill/overmux/commit/827c701ad8e2de3f9aa637fbff0d4e6e7acd2543) Thanks [@richardgill](https://github.com/richardgill)! - Update shared shortcut bindings for NativeWebView passthrough commands.

- [#32](https://github.com/richardgill/overmux/pull/32) [`a45f00f`](https://github.com/richardgill/overmux/commit/a45f00f8afadaf0d4554490d227281ba2dfed670) Thanks [@richardgill](https://github.com/richardgill)! - Focus active tmux terminals when their input element becomes ready, preserving focus on session changes. Rename the xterm input-element callback from `onInputChange` to `onInputElementChange` across terminal wrappers.

- Updated dependencies [[`827c701`](https://github.com/richardgill/overmux/commit/827c701ad8e2de3f9aa637fbff0d4e6e7acd2543), [`827c701`](https://github.com/richardgill/overmux/commit/827c701ad8e2de3f9aa637fbff0d4e6e7acd2543), [`209da69`](https://github.com/richardgill/overmux/commit/209da69f229a73ecc1f8162a4378085610f7568c), [`a45f00f`](https://github.com/richardgill/overmux/commit/a45f00f8afadaf0d4554490d227281ba2dfed670)]:
  - @overmux/pty@0.0.7
  - @overmux/terminal-stream@0.0.7
  - @overmux/xterm@0.0.10
  - overmux@0.0.10

## 0.0.10

### Patch Changes

- Updated dependencies [[`26b2b78`](https://github.com/richardgill/overmux/commit/26b2b789932813bea670cfcc35d9c5fdbbfac193), [`405ec4c`](https://github.com/richardgill/overmux/commit/405ec4c250415a168766b7192dbb7c9c2e991ea9)]:
  - overmux@0.0.9
  - @overmux/xterm@0.0.9

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
