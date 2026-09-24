# @overmux/tmux

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
