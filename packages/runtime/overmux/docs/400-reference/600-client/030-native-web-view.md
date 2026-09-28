---
title: Native web views
---

`NativeWebView` embeds a website in Overmux Desktop using a chrome native webview.

```tsx
import { NativeWebView } from "overmux/client";

export const Website = () => (
  <NativeWebView
    url="https://example.com"
    style={{ width: "100%", height: 600 }}
    fallback={
      <a href="https://example.com" target="_blank" rel="noopener noreferrer">
        Open website in browser
      </a>
    }
  />
);
```

## Props

`NativeWebViewProps` and `NativeWebViewLoadError` are exported from `overmux/client`.

### `url`

**Required.** Type: `string`. The initial website URL.

```tsx
import { NativeWebView } from "overmux/client";

<NativeWebView url="https://example.com" style={{ height: 600 }} />;
```

Changing this string navigates; rerendering the same URL preserves in-page navigation. A remount starts again at `url`, retaining cookies and site storage.

A blocked `url` prop clears the native page, including when an HTTP allowance is revoked. Blocked in-page links leave the current page in place. See [`allowedHttpOrigins`](#allowedhttporigins) for permitted destinations.

New-window links open in the system browser, not another embedded surface. The system browser has its own login state. Popup-based authentication flows may therefore not complete inside the embedded view; use in-page sign-in where supported.

### `className`

**Optional.** Type: `string`. No default. Applies a CSS class to the desktop placeholder `div`, not the embedded website.

```tsx
import { NativeWebView } from "overmux/client";

<NativeWebView
  url="https://example.com"
  className="website-pane"
  style={{ height: 600 }}
/>;
```

Define the class in your application's stylesheet. See [Theming and CSS](./theming) for loading styles.

### `style`

**Optional.** Type: `React.CSSProperties`. No default. Applies inline styles to the desktop placeholder `div`.

```tsx
import { NativeWebView } from "overmux/client";

<NativeWebView
  url="https://example.com"
  style={{ width: "100%", height: 600 }}
/>;
```

Give the placeholder a **nonzero width and height**. The component has no default height. Desktop follows its rectangular position and size as the layout moves, scrolls or resizes. Hidden and zero-size placeholders hide the native surface without clearing its site data. See [Layout limitations](#layout-limitations) before using overlapping panes or CSS effects.

### `fallback`

**Optional.** Type: `React.ReactNode`. Content shown in browsers, PWAs and desktop versions without native web view support.

```tsx
import { NativeWebView } from "overmux/client";

<NativeWebView
  url="https://example.com"
  style={{ height: 600 }}
  fallback={
    <a href="https://example.com" target="_blank" rel="noopener noreferrer">
      Open website in browser
    </a>
  }
/>;
```


### `onLoadError`

**Optional.** Type: `(error: NativeWebViewLoadError) => void`. No default handler. Receives `{ url, code, message }` for main-page load failures, blocked destinations, invalid configuration or bridge errors.

```tsx
import { NativeWebView, type NativeWebViewLoadError } from "overmux/client";

const reportLoadError = (error: NativeWebViewLoadError) => console.error(error);

<NativeWebView
  url="https://example.com"
  style={{ height: 600 }}
  onLoadError={reportLoadError}
/>;
```

Main-page failures exclude subresource failures and aborted navigation superseded by a newer request.

| Code | Meaning |
| --- | --- |
| Numeric string, such as `"-105"` | Chromium load error |
| `ERR_URL_BLOCKED` | Destination rejected by navigation policy |
| `ERR_DESKTOP_BRIDGE` | Bridge or configuration failure |
| `ERR_OPEN_EXTERNAL` | Failed to open the system browser |
| `ERR_RENDER_PROCESS_GONE` | Native renderer crashed; the surface is destroyed |

Remount to retry after a native renderer crash.

### `allowedHttpOrigins`

**Optional.** Type: `string[]`. Defaults to `[]`. Additional plain-HTTP origins to permit. An origin is the scheme, hostname and port, without a path.

```tsx
import { NativeWebView } from "overmux/client";

<NativeWebView
  url="http://devbox.local:3000"
  style={{ height: 600 }}
  allowedHttpOrigins={["http://devbox.local:3000"]}
/>;
```

HTTPS is allowed. HTTP is allowed for `localhost`, `127.0.0.1` and `[::1]`, plus exact origins in this list. Entries must be HTTP origins, optionally with a trailing slash. Wildcards, credentials, paths, queries and fragments are rejected. Matching includes the port. Other schemes are denied. Policy is enforced in Electron main for requested URLs, page navigation, redirects and new-window links.

### `passthroughBindings`

**Optional.** Type: `readonly ShortcutBinding[]`. Defaults to `[]`. Keyboard bindings to forward to the owning Overmux UI while the embedded page has focus. `ShortcutBinding` is exported from `overmux/client`.

```tsx
import { NativeWebView } from "overmux/client";

<NativeWebView
  url="https://example.com"
  style={{ height: 600 }}
  passthroughBindings={["Escape", "Control+Shift+X", ["F12", "P", "R"]]}
/>;
```

Uses the same binding and chord syntax as [command shortcuts](./shortcuts), but does not require a matching command registration. A chord is a sequence of key presses, such as F12, then P, then R.

Overmux desktop intercepts a completed configured binding before the embedded page receives it and forwards its keyboard input, including modifiers and releases, to the owning Overmux UI. That UI then handles it through its ordinary DOM listeners - for example, a dialog's Escape handler, a local `onKeyDown`, or the normal shortcut host. The embedded page remains sandboxed and receives no Overmux bridge or command capability.


## Security and shared sessions

Embedded pages have no Overmux bridge, preload script or Node access. Sandbox, context isolation and web security stay enabled. Permissions and downloads are denied.

All native views across connected Overmux instances share **one persistent desktop browser session**, `persist:overmux-native-web`. Cookies and login state survive unmounting, switching instances and restarting Desktop. This session is separate from Overmux authentication and from the system browser. Unmounting destroys the surface, not site data. Clearing an Overmux instance does not clear native website logins. There is no per-view profile or partition option.

## Layout limitations

Native surfaces paint **above the DOM**, including React modals, menus and dropdowns. Use ordinary, non-overlapping rectangular panes. DOM stacking order, rounded corners, CSS transforms, ancestor clipping and arbitrary CSS effects are not faithfully reproduced. Bounds are clipped to the host window, not arbitrary DOM containers. Avoid layouts that depend on those effects; unmount the view when its native surface must not cover other content.

There is no `visible` prop, toolbar, zoom or history API, overlap coordination, or pane/session restoration. Host document reloads, crashes, instance changes and window destruction also destroy its native surfaces.
