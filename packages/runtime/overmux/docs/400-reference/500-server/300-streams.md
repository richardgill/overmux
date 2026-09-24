---
title: Streams
---

Streams send and receive messages between your Overmux UI and server over a persistent connection. Use them for ongoing communication, such as terminal input and output or live logs.

Unlike [operations](./200-operations.md), streams can send and receive multiple messages. Unlike [resources](./100-resources.md), they deliver individual messages rather than a value clients read again when it changes.

## Defining a stream

Define streams in your server's `streams` object:

```ts
// server.ts
import {
  defineOvermuxServer,
  defineStreamContract,
  defineStreamHandler,
  noInputSchema,
} from "overmux";
import { z } from "zod";

const echoContract = defineStreamContract({
  input: noInputSchema,
  clientMessage: z.object({ message: z.string() }),
  serverMessage: z.object({ message: z.string() }),
});

export const serverConfig = defineOvermuxServer({
  streams: {
    echo: defineStreamHandler(echoContract, (_input, { emit }) => ({
      onMessage: ({ message }) => {
        emit({ message });
      },
    })),
  },
});
```

The object key, `echo`, is the stream's ID. Each time a client opens the stream, Overmux calls its handler to create a session.

Here, `onMessage` receives a message from the client and `emit` sends it back to that client.

### Input and messages

Use [Zod schemas](https://zod.dev/) to define:

- **`input`**: the input provided when opening the stream.
- **`clientMessage`**: messages sent from the UI to the server.
- **`serverMessage`**: messages sent from the server to the UI.

This example needs no opening input. Other streams might accept a terminal ID or a log file name.

The server can also call `emit` independently of client messages, for example when a process produces output.

## Accessing streams from your Overmux UI

Create typed hooks with `createOvermuxHooks` from `overmux/client`:

```ts
// hooks.ts
import { createOvermuxHooks } from "overmux/client";
import type { serverConfig } from "./server";

export const { useStream } = createOvermuxHooks<typeof serverConfig>();
```

The type-only import provides type checking without including server code in the browser.

Use the hook inside a component under your Overmux provider:

```tsx
import { useEffect, useState } from "react";
import { useStream } from "./hooks";

const Echo = () => {
  const { status, error, send, subscribe } = useStream({ id: "echo" });
  const [message, setMessage] = useState("");

  useEffect(
    () => subscribe(({ message }) => setMessage(message)),
    [subscribe],
  );

  if (error) return <p>{error.message}</p>;

  return (
    <div>
      <button
        disabled={status !== "open"}
        onClick={() => send({ message: "Hello world" })}
      >
        Send message
      </button>
      <p>{message}</p>
    </div>
  );
};
```

`send` sends a client message. `subscribe` registers a listener for server messages and returns a function that removes it, which the effect uses for cleanup.

Unlike `useResource`, `useStream` does not store the latest message as `data`. Your component decides how to display or process incoming messages.

See [Client API: Streams](../600-client/100-api.md#streams) for connection state and reconnection details.

## Cleaning up a stream

Return `dispose` from your handler to release resources when the session closes:

```ts
defineStreamHandler(echoContract, (_input, { emit }) => {
  const timer = setInterval(() => {
    emit({ message: "Still connected" });
  }, 1_000);

  return {
    onMessage: ({ message }) => {
      emit({ message });
    },
    dispose: () => {
      clearInterval(timer);
    },
  };
});
```

Overmux calls `dispose` once when the session closes. Use it to stop timers, remove listeners, or release other session-owned resources.

`useStream` closes its session when the component unmounts. You can also close it explicitly with `close()`.

The handler context provides an abort `signal` for cancelling background work and `fail(cause)` for failing and closing the session. See [Server API: Stream handlers](./500-api.md#stream-handlers).

## How streams work

Streams communicate over a persistent WebSocket connection between your browser and server.

Overmux validates the opening input and messages against the stream contract. Client messages are passed to `onMessage` in order; calls to `emit` send messages to that session's client.

A restored stream after a WebSocket reconnect creates a new server session. Do not assume that state held by the previous session survives.
