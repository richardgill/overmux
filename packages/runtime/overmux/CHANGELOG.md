# overmux

## 0.0.12

### Patch Changes

- [#43](https://github.com/richardgill/overmux/pull/43) [`b392280`](https://github.com/richardgill/overmux/commit/b3922800cfe31ca3d85c76fa3d364d146d96df88) Thanks [@richardgill](https://github.com/richardgill)! - Add structured `context.logger` logging to resource, stream, and operation handlers, with automatic capability and request/session correlation and safe cleanup logging.

  Replace the top-level `debug` boolean with `logLevel: "debug" | "info" | "warn" | "error"`, defaulting to `"info"` in development and production. Runtime and handler events use the same severity threshold with no lifecycle exceptions; browser console forwarding is enabled only at `"debug"`. Remove `debug` from existing configuration and use `logLevel: "debug"` when investigating. The runtime protocol version increases to reject older browser manifests.

## 0.0.11

### Patch Changes

- [#40](https://github.com/richardgill/overmux/pull/40) [`1a8bf22`](https://github.com/richardgill/overmux/commit/1a8bf22fb787b78a0beb8212fa33b074bfb9e9e5) Thanks [@richardgill](https://github.com/richardgill)! - Brand background notifications with the Overmux logo on a light background and a monochrome Android status-bar badge. Ship the notification images with the runtime so they remain available in development and production, including after session expiry.

- [#42](https://github.com/richardgill/overmux/pull/42) [`910ca21`](https://github.com/richardgill/overmux/commit/910ca216beeedeb7326baad6625452bb691fc801) Thanks [@richardgill](https://github.com/richardgill)! - Add a synchronous `onBeforeInputEvent` desktop configuration hook for the remote Overmux view and owned native web views, with cancellation before native-view passthrough. Document the hook and Linux Super+C/V configuration in the configuration reference.

- [#38](https://github.com/richardgill/overmux/pull/38) [`cfc58d8`](https://github.com/richardgill/overmux/commit/cfc58d8881fa847fc15f7a5a02c2ad5e702ebe02) Thanks [@richardgill](https://github.com/richardgill)! - Fix browser background notifications with a runtime-owned push service worker in development and production. Enable now registers an active worker with bounded failure reporting; notification clicks only navigate within the current origin.

## 0.0.10

### Patch Changes

- [#27](https://github.com/richardgill/overmux/pull/27) [`827c701`](https://github.com/richardgill/overmux/commit/827c701ad8e2de3f9aa637fbff0d4e6e7acd2543) Thanks [@richardgill](https://github.com/richardgill)! - Add NativeWebView for sandboxed embedded websites in Overmux Desktop, with persistent shared website sessions and browser fallback content.

- [#28](https://github.com/richardgill/overmux/pull/28) [`209da69`](https://github.com/richardgill/overmux/commit/209da69f229a73ecc1f8162a4378085610f7568c) Thanks [@richardgill](https://github.com/richardgill)! - Recommend @pierre/diffs for custom Git diff views in documentation and default AI context.

- Updated dependencies [[`827c701`](https://github.com/richardgill/overmux/commit/827c701ad8e2de3f9aa637fbff0d4e6e7acd2543)]:
  - @overmux/keybindings@0.0.7

## 0.0.9

### Patch Changes

- [#22](https://github.com/richardgill/overmux/pull/22) [`26b2b78`](https://github.com/richardgill/overmux/commit/26b2b789932813bea670cfcc35d9c5fdbbfac193) Thanks [@richardgill](https://github.com/richardgill)! - Allow resource subscriptions to set up asynchronously, safely release cleanup returned after cancellation, and refresh subscribers after setup completes.

- [#17](https://github.com/richardgill/overmux/pull/17) [`405ec4c`](https://github.com/richardgill/overmux/commit/405ec4c250415a168766b7192dbb7c9c2e991ea9) Thanks [@richardgill](https://github.com/richardgill)! - Replace legacy Git source-control resources with independent read-only status and selected-file diff resources. Remove the Git React UI, including its views, navigation commands, stylesheet, and browser exports. Pi now owns the patch renderer it uses directly.

  Preserve resource invalidations received during an active client read so subscribed views refresh after that read settles.

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
