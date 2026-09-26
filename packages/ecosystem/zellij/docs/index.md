---
title: Zellij (experimental)
---

> **Experimental:** compatibility is not guaranteed.

`@overmux/zellij` provides typed Zellij 0.45.1 state, stable targeted operations, and direct browser terminal streaming for Overmux.

## Installation

```sh
cd ~/.config/overmux
pnpm add @overmux/zellij
pnpm exec overmux integration install zellij
```

## Install the Zellij plugin

From a project with `@overmux/zellij` installed, run:

```sh
pnpm exec overmux integration install zellij
```

Outside Zellij, pass `--session <name>` when more than one session is active. The command atomically installs the bundled `overmux.wasm` under the XDG data directory, then opens a temporary floating pane in the selected session to approve only application-state and CLI-pipe access. The pane closes after the decision; the installer then verifies the pipe protocol and closes it. Re-run the same command after upgrading the package. Zellij 0.45.1 caches plugin bytes by file URL for a session's lifetime, so close and restart an existing target session before reinstalling a new plugin version. It does not edit `config.kdl` or create an alias.

## Public composition

```ts
import {
  defineZellijBackend,
  zellijOperationHandlers,
  zellijStateResource,
  zellijTerminalStream,
} from "@overmux/zellij/server";

const backend = defineZellijBackend();
const state = zellijStateResource({ backend });
const operations = zellijOperationHandlers({ backend });
const terminal = zellijTerminalStream({ allowInput: true, backend });
```

The backend identity defaults to `zellij`. Pass `{ id }` only when an application defines multiple Zellij backends. An optional `{ session }` prefers the session that anchors the plugin pipe; snapshots still include every active session.

The backend starts one persistent plugin pipe and publishes complete, versioned `SessionUpdate` snapshots. It does not poll tabs or panes. Targeted mutations wait for a newer matching plugin snapshot, and an exited anchor is replaced deterministically from the remaining sessions. Missing installation, permission, startup, and protocol failures are bounded and explain how to recover.

Zellij's JSON names and model remain visible. Pane identity is the pair `is_plugin` plus numeric `id`; tabs have stable numeric `tab_id` values. `TabInfo.active` is true when any attached client has that tab active, and `other_focused_clients` contains those client IDs. `PaneInfo.is_focused` likewise comes from Zellij's session state and can be true for the panes focused by different clients. These are aggregate multi-client observations, not claims about one globally active tab or pane. When independent clients focus different tabs, both tabs can therefore be `active`, each client ID appears on its tab, and each tab's display geometry reflects the client viewing it.

## Operations and intentional non-parity

The operation handlers expose only public 0.45.1 actions with explicit stable targets:

- `createTab`, `renameTab`, and `closeTab`
- `createPane` and `closePane`
- `renameSession` and `killSession`

Creation uses `--no-focus` and returns the tab or pane identity printed by Zellij. Focus, selection, movement, mode, and session-switch actions are intentionally absent because they act relative to a transient action client rather than a named attached client.

## Fixed terminal streams

Open a terminal stream with `{ sessionName }`. The server waits for the browser's initial resize, validates the session, then starts a normal PTY client with `zellij attach <session>`. Input and resize go directly to that client; ordered rendering acknowledgements and output backpressure come from `@overmux/terminal-stream`.

A stream never changes sessions. Change the input passed to Overmux's `useStream` to replace the stream and PTY. The replacement has a new terminal generation, so the shared terminal client resets xterm when its first output arrives. Disposing the stream terminates only its attached client and preserves the Zellij session.

`@overmux/terminal-stream` owns sequence validation, acknowledgement ordering, and pause/resume watermarks. The Zellij package only connects those shared controls to PTY `pause()` and `resume()`; its tests cover that delegation rather than duplicating the flow-control algorithm's unit suite.

## Compose a terminal

```tsx
import {
  ZellijXterm,
  useZellijTerminal,
  type ZellijTerminalConnection,
} from "@overmux/zellij/react";

const TerminalView = ({ stream, closeView }: {
  stream: ZellijTerminalConnection;
  closeView: () => void;
}) => {
  const terminal = useZellijTerminal({ stream });
  return (
    <>
      <ZellijXterm active terminal={terminal} />
      {terminal.error ? <div role="alert">{terminal.error.message}</div> : null}
      <button onClick={closeView}>Close</button>
    </>
  );
};
```

`useZellijTerminal({ stream, onError?, onConnectionStatusChange? })` owns connection cleanup and exposes `error`, `input`, `resize`, and `attachRenderer`. The application owns error and close UI; closing a view should unmount the hook owner. Changing the transport closes and unsubscribes the old client. React StrictMode's effect replay does not close the live transport.

`ZellijXterm` only owns rendering, active-view input gating, and shortcut input. It accepts `terminal`, not `stream`, `onClose`, or connection callbacks. Local xterm scrollback defaults to `0`; override it with `options={{ scrollback: 1_000 }}`. Use xterm's `className` and `style` props directly. The extra Zellij wrapper, `containerClassName`, `containerStyle`, `ZellijXtermStyle`, and `@overmux/zellij/styles.css` export have been removed; xterm loads its own styles.

### Renderer lifetime

A hook can have one renderer at a time. `terminal.attachRenderer({ fit, reset, write })` returns an idempotent detach function; detaching does not close the connection. Output arriving without a renderer remains pending, without acknowledgements. Shared terminal-stream write limits and server byte watermarks pause PTY output rather than buffering indefinitely. Custom transports must honor that server-side backpressure contract. Detachment releases writes already handed to the destroyed renderer once, since their callbacks may never fire; this does not mean the user saw them. Late callbacks cannot acknowledge a later attachment or terminal generation.

### Renderer remount limitation

**Known limitation: remount preserves the connection, not the terminal state.** Unmounting `ZellijXterm` destroys its screen, cursor/input modes, and partially parsed escape sequences. A new renderer receives only pending and future bytes, not previously acknowledged output. For example, an update to one line can appear without the heading painted before unmount. With no pending or new output, the remounted screen stays blank. Bytes completing an escape sequence begun in the old renderer can also be misinterpreted.

The fixed Zellij protocol has no redraw message, and the server ignores unchanged dimensions. Changing dimensions to provoke a redraw is not a reliable workaround: it can resize shared panes or have no effect because of another client's size. In development, StrictMode can also discard the first xterm after buffered output was delivered to it, leaving the replayed renderer empty. This does not affect every fresh mount, but preserving the transport during effect replay does not preserve xterm state.

**Workaround: keep `ZellijXterm` mounted when switching or hiding views.** Preserve its usable dimensions and use `visibility: hidden` with `active={false}` rather than conditionally rendering it:

```tsx
<ZellijXterm
  terminal={terminal}
  active={visible}
  style={{ visibility: visible ? "visible" : "hidden" }}
/>
```

The existing emulator continues processing output while hidden; `active={false}` gates input, not output or sizing.

If the renderer was destroyed, replacing the fixed stream and its PTY client obtains fresh attachment output, but creates a different client and does not guarantee the previous client's tab/pane selection. A never-sized stream still waits for initial dimensions before attaching; this API makes no headless navigation or redraw guarantees. Automatic restoration of a destroyed renderer is not implemented.

The renderer-neutral `createZellijTerminalClient` remains available from `@overmux/zellij/client`.
