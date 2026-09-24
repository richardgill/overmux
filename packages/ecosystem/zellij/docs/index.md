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

```tsx
import { ZellijXterm } from "@overmux/zellij/react";
import "@overmux/zellij/styles.css";

<ZellijXterm active onClose={closeView} stream={stream} />;
```

`ZellijXterm` owns xterm composition, active-view input gating, shortcut input, and error/close presentation. The renderer-neutral `createZellijTerminalClient` is available from `@overmux/zellij/client`.
