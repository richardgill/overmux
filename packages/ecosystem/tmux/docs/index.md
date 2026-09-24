---
title: Tmux
---

`@overmux/tmux` brings tmux sessions, windows, panes, and interactive terminals into your Overmux.

## Installation

```sh
cd ~/.config/overmux
pnpm add @overmux/tmux
```

Tmux must be installed on the machine running your Overmux server.

## `@overmux/tmux/server`

Connect to tmux running on your Overmux host:

- `tmuxOperations` provides window, pane, session, and configuration operations.
- `tmuxResource` provides connection state and the session/window/pane hierarchy.
- `tmuxStream` provides an interactive terminal stream.

```ts title="overmux.config.ts"
import { defineOvermuxConfig } from "overmux";
import {
  defineTmuxControlBackend,
  tmuxOperations,
  tmuxResource,
  tmuxStream,
} from "@overmux/tmux/server";

const backend = defineTmuxControlBackend({ socket: "default" });

export default defineOvermuxConfig({
  ...
  server: {
    operations: tmuxOperations({ backend }),
    resources: {
      tmux: tmuxResource({ backend }),
    },
    streams: {
      tmux: tmuxStream({ backend }),
    },
  },
});
```

Resources and streams have separate namespaces, so both use `tmux` as their registration ID. Clients access them with `useResource({ id: "tmux" })` and `useStream({ id: "tmux" })`.

### `defineTmuxControlBackend`

Connect to one tmux server. `socket` accepts a name or an absolute socket path:

```ts
// Standard server: tmux
defineTmuxControlBackend({ socket: "default" });

// Named server: tmux -L work
defineTmuxControlBackend({ socket: "work" });

// Explicit socket: tmux -S /tmp/my-tmux.sock
defineTmuxControlBackend({ socket: "/tmp/my-tmux.sock" });
```

Each socket identifies a separate tmux server with its own sessions. Omit `socket` to use `"default"`.

Optional settings:

```ts
defineTmuxControlBackend({
  socket: "work",
  id: "work",
  configPath: "/home/me/.tmux.conf",
});
```

- `id` identifies this backend in its state, useful when connecting to multiple tmux servers. Defaults to `"default"`.
- `configPath` selects the file used by the [`reloadTmuxConfig`](#reloadtmuxconfig) operation.

### `tmuxResource`

Expose tmux connection state and the session/window/pane hierarchy as a subscription resource.

```ts title="overmux.config.ts"
import { defineOvermuxConfig } from "overmux";
import {
  defineTmuxControlBackend,
  tmuxResource,
} from "@overmux/tmux/server";

const backend = defineTmuxControlBackend({ socket: "default" });

export default defineOvermuxConfig({
  ...
  server: {
    resources: {
      tmux: tmuxResource({ backend }),
    },
  },
});
```

Example Tmux State:

```ts
{
  backend: { id: "work" },
  connected: true,
  hierarchy: {
    sessions: [{
      id: "$1",
      name: "work",
      activeWindowId: "@2",
      windows: [{
        id: "@2",
        index: 0,
        name: "editor",
        activePaneId: "%3",
        panes: [{
          id: "%3",
          index: 0,
          path: "/home/me/project",
          title: "editor",
          currentCommand: "nvim",
          inCopyMode: false,
        }],
      }],
    }],
  },
}
```

### `tmuxStream`

Expose an interactive tmux terminal stream.

```ts title="overmux.config.ts"
import { defineOvermuxConfig } from "overmux";
import {
  defineTmuxControlBackend,
  tmuxStream,
} from "@overmux/tmux/server";

const backend = defineTmuxControlBackend({ socket: "default" });

export default defineOvermuxConfig({
  ...
  server: {
    streams: {
      tmux: tmuxStream({
        backend,
        allowInput: true,
        geometryPolicy: "shared",
      }),
    },
  },
});
```

- `allowInput` defaults to `true`. Set it to `false` to discard browser keystrokes.
- `geometryPolicy` defaults to `"shared"`. Use `"ignore-size"` to avoid affecting shared tmux window dimensions.

The stream opens without an input payload. Clients navigate after opening.

### `tmuxOperations`

Expose the operations below under `server.operations`.

```ts title="overmux.config.ts"
import { defineOvermuxConfig } from "overmux";
import {
  defineTmuxControlBackend,
  tmuxOperations,
} from "@overmux/tmux/server";

const backend = defineTmuxControlBackend({ socket: "default" });

export default defineOvermuxConfig({
  ...
  server: {
    operations: tmuxOperations({ backend }),
  },
});
```

Operations return one of:

```ts
{ outcome: "success" }
{ outcome: "not-found" }
{ outcome: "error", message: "..." }
```

Payloads use tmux IDs: `$1` for a session, `@2` for a window, `%3` for a pane. These are not names or numeric indices.

#### `createTmuxWindow`

Create a Tmux window using the pane’s working directory, without selecting it.

```ts
createTmuxWindow({ paneId }: { paneId: string })
```

Usage:

```ts
const createTmuxWindow = useOperation({ id: "createTmuxWindow" });
createTmuxWindow.mutate({ paneId: "%3" });
```

#### `splitTmuxPane`

Split a Tmux pane, preserving its working directory. `"horizontal"` places panes side by side; `"vertical"` stacks them.

```ts
splitTmuxPane({ paneId, direction }: { paneId: string; direction: "horizontal" | "vertical" })
```

Usage:

```ts
const splitTmuxPane = useOperation({ id: "splitTmuxPane" });
splitTmuxPane.mutate({ paneId: "%3", direction: "horizontal" });
```

#### `selectTmuxPane`

Select a Tmux pane within a window. Checks that the pane belongs to the window.

```ts
selectTmuxPane({ windowId, paneId }: { windowId: string; paneId: string })
```

Usage:

```ts
const selectTmuxPane = useOperation({ id: "selectTmuxPane" });
selectTmuxPane.mutate({ windowId: "@2", paneId: "%3" });
```

#### `selectTmuxWindow`

Select a Tmux window within a session. Checks that the window belongs to the session.

```ts
selectTmuxWindow({ sessionId, windowId }: { sessionId: string; windowId: string })
```

Usage:

```ts
const selectTmuxWindow = useOperation({ id: "selectTmuxWindow" });
selectTmuxWindow.mutate({ sessionId: "$1", windowId: "@2" });
```

#### `moveTmuxWindow`

Swap a Tmux window with its neighbour. Wraps at either end.

```ts
moveTmuxWindow({ windowId, direction }: { windowId: string; direction: "left" | "right" })
```

Usage:

```ts
const moveTmuxWindow = useOperation({ id: "moveTmuxWindow" });
moveTmuxWindow.mutate({ windowId: "@2", direction: "left" });
```

`direction` accepts `"left"` or `"right"`.

#### `detachTmuxSession`

Detach clients attached to a Tmux session. Leaves the session running.

```ts
detachTmuxSession({ sessionId }: { sessionId: string })
```

Usage:

```ts
const detachTmuxSession = useOperation({ id: "detachTmuxSession" });
detachTmuxSession.mutate({ sessionId: "$1" });
```

#### `killTmuxPane`

Destroy a Tmux pane.

```ts
killTmuxPane({ paneId }: { paneId: string })
```

Usage:

```ts
const killTmuxPane = useOperation({ id: "killTmuxPane" });
killTmuxPane.mutate({ paneId: "%3" });
```

#### `killTmuxSession`

Destroy a Tmux session.

```ts
killTmuxSession({ sessionId }: { sessionId: string })
```

Usage:

```ts
const killTmuxSession = useOperation({ id: "killTmuxSession" });
killTmuxSession.mutate({ sessionId: "$1" });
```

#### `reloadTmuxConfig`

Reload the backend’s `configPath`, or the configuration files reported by tmux.

No input payload.

```ts
reloadTmuxConfig()
```

Usage:

```ts
const reloadTmuxConfig = useOperation({ id: "reloadTmuxConfig" });
reloadTmuxConfig.mutate();
```

## `@overmux/tmux/react`

Connect your React UI to Tmux and render an interactive terminal.

### React composition

```tsx
import { createOvermuxHooks } from "overmux/client";
import { TmuxXterm, useTmuxTerminal } from "@overmux/tmux/react";

type ServerConfig = typeof import("./overmux.config").default.server;

const { useStream } = createOvermuxHooks<ServerConfig>();

export const TerminalPanel = ({ sessionId }: { sessionId: string }) => {
  const stream = useStream({ id: "tmux" });
  const terminal = useTmuxTerminal({ stream, onError: console.error });

  return (
    <>
      <button
        onClick={() => {
          void terminal.goTo({ sessionId }).catch(console.error);
        }}
      >
        Connect
      </button>
      <TmuxXterm terminal={terminal} style={{ height: 400 }} />
    </>
  );
};
```

Uses the [`tmuxStream`](#tmuxstream) registered as `tmux` in your server config.

### `useTmuxTerminal`

Manage terminal navigation and connection lifecycle independently of rendering.

#### Navigation

Use tmux IDs, not names or numeric indices:

```ts
await terminal.goTo({ sessionId: "$1" });
await terminal.goTo({ sessionId: "$1", windowId: "@2" });
await terminal.goTo({ sessionId: "$1", windowId: "@2", paneId: "%3" });
```

`goTo` resolves with the confirmed `{ sessionId, windowId, paneId }`. A newer navigation cancels a pending one. Handle rejected promises when navigation fails or is cancelled.

#### State and callbacks

- `location`: current `{ sessionId, windowId, paneId }`, initially `undefined`.
- `error`: current terminal or recovery error, or `undefined`.
- `onError`: callback for transport, output-processing, and recovery failures.
- `onConnectionStatusChange`: callback when the connection status changes.

After reconnection, the hook restores the last observed session, using its current window and pane. Unmounting the renderer does not close the connection; unmounting the hook cleans up the terminal client.

### `TmuxXterm`

Render an [xterm.js](https://xtermjs.org/) terminal using [`@overmux/xterm`](/docs/packages/xterm) connected to your tmux stream.

```tsx
<TmuxXterm
  terminal={terminal}
  active={true}
  options={{ fontSize: 14 }}
  style={{ height: 400 }}
/>
```

- `terminal`: the value returned by `useTmuxTerminal`.
- `active`: defaults to `true`. Set to `false` to disable input forwarding and automatic focus while continuing to render output.
- Other props, including `options`, `style`, and `ref`, are forwarded to [`XtermTerminal`](/docs/packages/xterm). All its props are supported except `containerRef`; input and resize callbacks run alongside the Tmux handlers.

For server-enforced input blocking, set `allowInput: false` on `tmuxStream`. `TmuxXterm` provides application input gating through `active`, active focus, and shortcut input-target registration. It renders only `XtermTerminal`; applications own error messages and close controls. Style the xterm wrapper with `className` and `style`; there is no tmux stylesheet. Application-owned mobile keys can send through its forwarded xterm `input` handle. Give the parent a bounded height and keep error UI above or below the terminal.

## Control client policy

`defineTmuxControlBackend` keeps one targetless `tmux -C` process attached with `no-output,ignore-size`. Control mode must attach to a live session, but the hidden client has no session-specific UI. With global `detach-on-destroy off`, tmux moves that client to another surviving session. With `detach-on-destroy on`, tmux exits it and Overmux reconnects. When the server disappears or no sessions exist, Overmux retries with bounded backoff and does not create an internal session.

Control notifications invalidate the typed state cache. Authoritative snapshots come from `list-sessions` and `list-panes`, with debounced notification refreshes and slow reconciliation while state has subscribers.

## Direct terminal clients

Each terminal owns one normal PTY-backed tmux client attached directly to a real session. Browser and physical clients share active windows, active panes, status options, and, with `geometryPolicy: "shared"`, pane geometry. Navigation reuses that same full-window client, PTY, and renderer. A pane target selects the active pane; it does not crop the display to that pane.

Navigation works without a renderer. Until a renderer reports its dimensions, the client uses default dimensions with tmux's `ignore-size` flag, so it cannot resize existing tmux windows. Once a renderer reports its size, the configured geometry policy applies.

## Renderer-independent lifecycle

Use the renderer-neutral client when integrating without React. For React, see [React composition](#react-composition).

```ts
import { createTmuxTerminalClient } from "@overmux/tmux/client";

const terminal = createTmuxTerminalClient({ connection: stream, sink });
const location = await terminal.goTo({ sessionId: "$1" });
terminal.resize({ cols: 120, rows: 40 });
// Dispose when the integration ends, not when its renderer is hidden.
terminal.dispose();
```

`goTo` accepts `{ sessionId }`, `{ sessionId, windowId }`, or `{ sessionId, windowId, paneId }` and resolves with the full server-confirmed location. It queues while opening and works before renderer readiness. Disconnection, navigation failure, send failure, or disposal rejects it; interrupted requests are not replayed. A newer valid call immediately rejects the previous pending call with an error whose `name` is `"AbortError"`. Catch navigation rejections at the call site.

`location` is `undefined` until confirmed, then always the full `{ sessionId, windowId, paneId }`. It reflects server observations, including native tmux changes, not desired state. Disconnecting or replacing the transport clears the exposed location. Failed automatic recovery appears in `terminal.error` and `onError`; failed targets are not retried automatically.

Attach a custom renderer with `terminal.attachRenderer(renderer)` in an effect and return its detach function. The renderer supplies `fit`, `reset`, and completion-aware `write`, plus optional `cancelPendingInput` to discard locally pending input without changing focus; wire input and size events to `terminal.input` and `terminal.resize`. Only one renderer can attach at a time. `onConnectionStatusChange` reports `opening`, `open`, or `closed` independently of output; `onError` reports transport, output, and automatic recovery failures.

Text input remains a string. Binary input is transported as `Uint8Array` and written to node-pty as a `Buffer`, preserving byte values end to end.

## Synchronized output

Enable tmux's `sync` terminal feature for the terminal type used by Overmux. This is important for fullscreen TUIs that emit atomic frames with synchronized output (`CSI ?2026 h/l`). Without the feature, tmux forwards a frame incrementally and xterm may visibly paint a partial screen before the rest arrives.

Overmux uses `xterm-256color`:

```
set-option -ga terminal-features ",xterm-256color:sync"
```

Reload the tmux configuration and recreate or reattach existing clients because terminal features are detected when clients attach.
