# Overmux Desktop

`@overmux/desktop` is the desktop host for an existing Overmux server. It loads the configured server in a secure Electron window and does not own the server lifecycle.

On NixOS:

```sh
OVERMUX_SERVER_URL=http://127.0.0.1:4242 nix run .#overmux-desktop
```

Outside NixOS, run it from the workspace:

```sh
OVERMUX_SERVER_URL=http://127.0.0.1:4242 pnpm --filter @overmux/desktop dev
```

Without `OVERMUX_SERVER_URL`, the app restores its saved server URL or prompts for one. The desktop package never starts or bundles the Overmux server; install and run the `overmux` npm package separately.

**Instance → Reload Overmux** (`Cmd/Ctrl+R`) reloads the current page as usual. **Reset Overmux to Configured Server** (`Cmd/Ctrl+Shift+R`) returns to `OVERMUX_SERVER_URL` when nonempty, otherwise the URL saved in `desktop-config.json`, otherwise the connection screen. Startup and window reopen use the same precedence, even if a deep link has connected the current window elsewhere. Reset clears the dedicated remote session's HTTP cache before navigating once; it does not clear cookies, local storage, or service workers, log you out, or change the saved URL.

## Linux packages

Linux x86_64 releases provide an AppImage and Debian package. Verify the downloaded files against `SHA256SUMS`, then run one of:

```sh
chmod +x Overmux-Desktop-<version>-linux-x64.AppImage
./Overmux-Desktop-<version>-linux-x64.AppImage

sudo apt install ./overmux-desktop_<version>_amd64.deb
overmux-desktop
```

Build and verify both packages locally on Linux with:

```sh
pnpm --filter @overmux/desktop package:linux
node apps/desktop/scripts/desktop-release.ts verify linux-x64
xvfb-run --auto-servernum node apps/desktop/scripts/desktop-release.ts smoke linux-x64
```

Upgrades are manual: replace the AppImage or install the newer Debian package. Remove the AppImage directly or run `sudo apt remove overmux-desktop` to uninstall. Automatic updates are intentionally deferred.

Approved source artwork is not yet available, so these packages currently use electron-builder's fallback Electron icon. Original Overmux code is [MIT licensed](./LICENSE); packages include Overmux and third-party license notices. See the canonical [desktop distribution notes](../../notes/desktop-distribution.md) for the packaging boundary, verification, release process, and remaining branding work.

## Desktop configuration

Overmux loads desktop chrome settings from `$XDG_CONFIG_HOME/overmux/overmux.desktop.ts`, falling back to `~/.config/overmux/overmux.desktop.ts`. A missing file uses the current desktop defaults.

```ts
import { defineOvermuxDesktopConfig } from "@overmux/desktop";

export default defineOvermuxDesktopConfig({
  titleBar: "hidden",
  menuBar: "auto-hide",
  macosTitleBarStyle: "transparent",
  macosTrafficLights: "visible",
});
```

The configuration is deliberately flat and supports only these settings:

| Setting | Values | Default | Behavior |
| --- | --- | --- | --- |
| `titleBar` | `"native"`, `"hidden"` | `"hidden"` | Selects the native or content-sized title bar on every platform. |
| `menuBar` | `"visible"`, `"auto-hide"`, `"hidden"` | `"auto-hide"` | Controls the window menu on Linux and Windows. Auto-hide reveals it with `Alt`; macOS keeps its global menu. |
| `macosTitleBarStyle` | `"native"`, `"transparent"` | unset | Overrides `titleBar` on macOS. Transparent extends content into the title-bar area. |
| `macosTrafficLights` | `"visible"`, `"hidden"` | `"hidden"` | Controls the native macOS close, minimize, and zoom buttons together. |

Use `--desktop-config <path>` to load an explicit file during development or testing. The file is trusted TypeScript, loaded once at startup, and must be valid before Electron creates a window. Changes require restarting the app.

## Experimental macOS preview

macOS arm64 and x64 releases provide separate ZIPs. They are **experimental unsigned, non-notarized previews**: macOS cannot verify their publisher, and compatibility is not guaranteed. No DMG is published before Apple Developer ID signing and notarization exist.

Install the newest stable preview for the current architecture into `~/Applications/Overmux.app`:

```sh
overmux desktop install
overmux desktop upgrade
```

First install requires confirmation of the unsigned application risk; use `overmux desktop install --yes` only for reviewed automation. The installer verifies the official GitHub asset's size and SHA-256 checksum, validates the bundle, applies an ad-hoc signature if needed, removes quarantine from the staged bundle, and launches it. It never uses `sudo` or `/Applications`.

Build and verify a ZIP locally on a Mac, replacing `<arch>` with `arm64` or `x64`:

```sh
pnpm --filter @overmux/desktop package:mac:<arch>
node apps/desktop/scripts/desktop-release.ts verify mac-<arch>
node apps/desktop/scripts/desktop-release.ts smoke mac-<arch>
```

`package:mac:dir` creates only an unpacked `.app` for development. Packaging intentionally uses no signing identity, notarization credentials, updater, or bundled server. See the canonical [desktop distribution notes](../../notes/desktop-distribution.md) for the security boundary and release process.

The trusted local React shell contains the server content in a sandboxed `WebContentsView` backed by the dedicated persistent `persist:overmux-remote` session, with no Node integration or unrestricted Electron API. Its narrow preload capabilities are clipboard writes, typed notifications, and version 1 instance identity reports. Reloading, clearing the instance, and opening detached DevTools for the active view remain available from the native application menu.

## Instance discovery

After WebSocket authentication, the browser reports the server's instance ID through `overmuxHost.instance.report({ instanceId })`. Desktop accepts only the current remote main frame at the configured origin. The selected connection address is remembered with its latest reported ID; page navigation does not change that address. Multiple addresses can identify the same server, ordered by most recent use, and a new authenticated ID replaces an address's previous association without confirmation. Configured launches also remember these addresses. The saved `instanceAddresses` list contains one entry per URL, each with its latest reported `instanceId`. Clearing an instance forgets its selected address but keeps other remembered addresses.

## Deep links

Deep links identify an instance, not its network address:

```text
overmux://rich-work-4242/tmux/$71/@647/%25647
overmux://work.station-1/workspace?tab=terminal#pane-2
```

The authority is only a lookup key. IDs use lowercase ASCII letters and digits, may contain internal dots or hyphens, and have a maximum length of 253 characters. Even an ID that looks like a hostname is never interpreted as an address. Ports, credentials, and escaped IDs are rejected; address-based links are not supported.

A link matching the active authenticated ID opens at the active connection address without confirmation or reloading the document. Desktop pushes the route into browser history using `pushState`, without dispatching a synthetic `popstate` event. Application routing must observe `pushState` changes, as TanStack Router's browser history does, not just the initial mount. For terminal routes, request the new target and wait for its confirmation before reflecting the terminal's location back into the URL; otherwise the previous pane can overwrite the requested route. For another remembered ID, Desktop confirms replacement (with an additional warning for HTTP), connects to its most recently used address, and waits for that address to report the expected authenticated ID before opening the route. Multiple addresses can belong to one ID. A changed ID updates the remembered association silently, but cancels any link expecting the old ID with an expected-versus-actual error.

Unknown IDs are rejected without changing the connection. Connect to the instance normally first, then reopen the link; Desktop never guesses an address from the ID or resumes a rejected link automatically.

When a link launches Desktop while the app is not running, saved credentials may still sign the user in, but the website must first load and report its authenticated identity. After loading a remembered address, Desktop allows up to five seconds for that report; the same short wait applies when switching instances. This is not a sign-in workflow: if no identity arrives, Desktop discards the requested route and leaves the page available for normal connection and sign-in. Click the link again afterward; signing in later does not resume it automatically.

Closing, clearing, resetting, or replacing the connection cancels pending link work. A newer link also cancels an earlier one, including a hanging page load; replacement dialogs are serialized so they do not overlap. There is no verification banner or separate cancel-link control.

Desktop accepts any safe application route, not just tmux routes. An omitted route means `/`. The pane ID `%647` encodes its literal percent once as `%25`; do not encode the entire route again. Safe path, query, and fragment text is retained without re-encoding, including empty `?` and `#`. All query text belongs to the application, including `overmux-scheme`, which has no special meaning. Malformed escapes, controls, backslashes, dot segments, and paths that could change the selected origin are rejected before URL normalization.

`XtermTerminal` and `TmuxXterm` detect plain-text links as well as OSC 8 links. In a browser/PWA, clicking `overmux:` asks the OS to open the installed desktop app, subject to browser prompts and protocol registration. In Electron, it routes inside the existing desktop host rather than opening a child window or relaunching through the OS. See the [xterm link documentation](../../packages/ecosystem/xterm/docs/index.md#links) for standalone terminal setup.

## Browser data and notifications

The entire Electron profile lives in `$XDG_STATE_HOME/overmux/desktop`, defaulting to `~/.local/state/overmux/desktop` when `XDG_STATE_HOME` is unset, empty, or relative. This includes `desktop-config.json` (saved server URL and instance addresses), cookies, local storage, persistent sessions, and Chromium caches. Desktop chrome configuration remains under `$XDG_CONFIG_HOME/overmux` as described above.

This is a fresh profile: Desktop does not migrate, read, or delete the previous Electron profile (for example, `~/.config/@overmux/desktop` on Linux). Reconnect to your servers and sign in again after upgrading. For an isolated test profile, set `XDG_STATE_HOME` to an absolute temporary directory; `--user-data-dir` does not override this location.

The active view receives operation notifications through the live WebSocket and its narrow version 1 preload bridge. Electron validates the exact `{ title, body?, open?: { link } }` contract and only accepts requests from that view's main frame at the configured origin. Clicking a native notification revalidates the active source, focuses the app, and opens its link. The native path does not use Chromium notification permission or background notification delivery.

Electron receives notifications only while connected. Cross-origin HTTP(S) links open in the system browser; child windows and unsafe schemes are denied.

Clearing an instance removes its URL and origin-scoped cookies, local storage, IndexedDB, file-system data, cache storage, and service workers. Chromium exposes HTTP cache clearing only at session scope, so the action also clears the entire dedicated session HTTP cache.
