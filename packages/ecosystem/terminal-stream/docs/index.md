---
title: Terminal stream
---

# Terminal stream

`@overmux/terminal-stream` supplies terminal message contracts, renderer-side ordered delivery, and server-side output flow control without defining a multiplexer protocol or session model.

## Installation

```sh
cd ~/.config/overmux
pnpm add @overmux/terminal-stream
```

## Client

Create a renderer-side terminal client from a connection that carries the shared terminal messages:

```ts
import { createTerminalStreamClient } from "@overmux/terminal-stream/client";

const terminal = createTerminalStreamClient({ connection, sink });
terminal.input("pwd\r");
terminal.resize({ cols: 120, rows: 40 });
```

Integrations route their additional messages at the connection boundary.

## Server

Use `createTerminalOutputFlow` from `@overmux/terminal-stream/server` to chunk output, sequence rendered acknowledgements, and pause or resume an output source when unacknowledged bytes cross configured thresholds.

Message schemas and types are available from `@overmux/terminal-stream/shared`.
