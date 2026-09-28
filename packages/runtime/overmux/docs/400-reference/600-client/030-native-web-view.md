---
title: Native web views
---

`NativeWebView` embeds a website in Overmux Desktop without an iframe. It uses Electron's sandboxed browser surface, so sites that disallow iframe embedding can still load.

```tsx
import { NativeWebView, type NativeWebViewLoadError } from "overmux/client";

const prUrl = "https://github.com/owner/repo/pull/123";
const reportLoadError = (error: NativeWebViewLoadError) => console.error(error);

export const PullRequestBrowser = () => (
  <NativeWebView
    url={prUrl}
    className="pr-browser"
    style={{ width: "100%", height: 600 }}
    fallback={
      <a href={prUrl} target="_blank" rel="noopener noreferrer">
        Open PR in browser
      </a>
    }
    onLoadError={reportLoadError}
    allowedHttpOrigins={["http://devbox.local:3000"]}
  />
);
```

Give the placeholder a **nonzero width and height**. The component has no default height. Desktop follows its rectangular position and size as the layout moves, scrolls or resizes. Hidden and zero-size placeholders hide the native surface without clearing its site data.

## Props

`NativeWebViewProps` and `NativeWebViewLoadError` are exported from `overmux/client`.

| Prop | Type | Behavior |
| --- | --- | --- |
| `url` | `string` | Initial URL. Changing this string navigates; rerendering the same URL preserves in-page navigation. |
| `className` | `string` | Class for the desktop placeholder `div`. |
| `style` | `React.CSSProperties` | Styles for the desktop placeholder `div`. |
| `fallback` | `React.ReactNode` | Browser/PWA and unsupported-desktop content. Omit to render nothing there. |
| `onLoadError` | `(error: NativeWebViewLoadError) => void` | Receives `{ url, code, message }` for main-page load failures, blocked destinations, invalid configuration or bridge errors. |
| `allowedHttpOrigins` | `string[]` | Exact additional plain-HTTP origins to permit. Defaults to `[]`. |

Fallback content is **not** displayed after a navigation error. A blocked `url` prop clears the native page, including when an HTTP allowance is revoked. Blocked in-page links leave the current page in place. Main-page failures exclude subresource failures and aborted navigation superseded by a newer request. Chromium load errors use numeric codes as strings; policy failures use `ERR_URL_BLOCKED`, bridge/configuration failures use `ERR_DESKTOP_BRIDGE`. Failed system-browser opens use `ERR_OPEN_EXTERNAL`; a native renderer crash reports `ERR_RENDER_PROCESS_GONE` and destroys the surface. Remount to retry after a native renderer crash.

## Navigation and security

HTTPS is allowed. HTTP is allowed for `localhost`, `127.0.0.1` and `[::1]`, plus exact origins in `allowedHttpOrigins`. Entries must be HTTP origins, for example `http://devbox.local:3000`, optionally with a trailing slash. Wildcards, credentials, paths, queries and fragments are rejected. Matching includes the port. Other schemes are denied. Policy is enforced in Electron main for requested URLs, page navigation, redirects and new-window links.

New-window links open in the system browser, not another embedded surface. The system browser has its own login state. Popup-based authentication flows may therefore not complete inside the embedded view; use in-page sign-in where supported.

Embedded pages have no Overmux bridge, preload script or Node access. Sandbox, context isolation and web security stay enabled. Permissions and downloads are denied.

All native views across connected Overmux instances share **one persistent desktop browser session**, `persist:overmux-native-web`. Cookies and login state survive unmounting, switching instances and restarting Desktop. This session is separate from Overmux authentication and from the system browser. Unmounting destroys the surface, not site data. Clearing an Overmux instance does not clear native website logins. There is no per-view profile or partition option.

## Layout limitations

Native surfaces paint **above the DOM**, including React modals, menus and dropdowns. Use ordinary, non-overlapping rectangular panes. DOM stacking order, rounded corners, CSS transforms, ancestor clipping and arbitrary CSS effects are not faithfully reproduced. Bounds are clipped to the host window, not arbitrary DOM containers. Avoid layouts that depend on those effects; unmount the view when its native surface must not cover other content.

There is no `visible` prop, toolbar, zoom or history API, overlap coordination, or pane/session restoration. A remount starts again at `url`, retaining cookies and site storage. Host document reloads, crashes, instance changes and window destruction also destroy its native surfaces.
