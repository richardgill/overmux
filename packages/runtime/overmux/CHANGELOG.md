# overmux

## 0.0.8

### Patch Changes

- [#13](https://github.com/richardgill/overmux/pull/13) [`a73f207`](https://github.com/richardgill/overmux/commit/a73f20729477037e0d779c181e79d04d5c55af71) Thanks [@richardgill](https://github.com/richardgill)! - Generate project-local pnpm build approval for node-pty during init, including when tmux is added later. Require pnpm 10.5.0 or newer so the workspace allowlist is honored.

- [#15](https://github.com/richardgill/overmux/pull/15) [`ab776b6`](https://github.com/richardgill/overmux/commit/ab776b659a54877a82af52d2150c14942457839c) Thanks [@richardgill](https://github.com/richardgill)! - Use Zod 4.6.5 throughout the workspace and rebuild dependent packages. Packages exposing Zod schemas now share the application's installation through a ^4.6.5 peer dependency so public schemas remain type-compatible. Newly initialized applications explicitly depend on Zod ^4.6.5.

- Updated dependencies [[`ab776b6`](https://github.com/richardgill/overmux/commit/ab776b659a54877a82af52d2150c14942457839c)]:
  - @overmux/keybindings@0.0.6

## 0.0.7

### Patch Changes

- [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0) Thanks [@richardgill](https://github.com/richardgill)! - Keep development HMR connections active with server-to-browser heartbeats, preventing idle Android connections from closing and triggering Vite reconnect reloads while preserving live updates.

- [`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0) Thanks [@richardgill](https://github.com/richardgill)! - Declare MIT licensing for original Overmux code, include distribution licenses and third-party notices, and establish current-version changelog baselines for public source releases.

- Updated dependencies [[`76e3195`](https://github.com/richardgill/overmux/commit/76e319576de46181b76a2c812f7f12f7eb6f36c0)]:
  - @overmux/keybindings@0.0.5

## 0.0.6

Current-version baseline: Overmux CLI, trusted server runtime, and browser APIs for application-owned workspaces.
