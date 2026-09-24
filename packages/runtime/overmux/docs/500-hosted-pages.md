---
title: Hosted pages
---

# Hosted pages

Overmux reserves two authenticated client paths above the user application router:

- `/_overmux/settings` provides notification and session settings.
- `/_overmux/logout` ends the current session and returns to login.

Use the neutral public constants when linking from userland or host integrations:

```tsx
import {
  createOvermuxSettingsPath,
  overmuxLogoutPath,
} from "overmux";

const returnTo = `${location.pathname}${location.search}${location.hash}`;

<a href={createOvermuxSettingsPath(returnTo)}>Overmux settings</a>
<a href={overmuxLogoutPath}>Log out</a>
```

These are full-document destinations. Do not send them through a userland client router.

`createOvermuxSettingsPath(returnTo)` includes a same-origin application path for **Back to Overmux**. Absolute URLs, protocol-relative URLs, login and API paths, and reserved `/_overmux` paths are discarded. Use `resolveOvermuxReturnTo()` when the validated return path is needed separately.

Browser notification controls live on the settings page. In the Electron desktop app, settings instead explains that delivery uses the desktop app and notification permissions are managed by the operating system.
