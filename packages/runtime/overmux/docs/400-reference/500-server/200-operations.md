---
title: Operations
---

Operations expose server-side functions you can call from your UI or the `overmux call` CLI.

## Defining an operation

Define operations in your server's `operations` object:

```ts
// server.ts
export const serverConfig = defineOvermuxServer({
  operations: {
    echo: {
      input: z.object({ message: z.string() }),
      output: z.string(),
      handle: ({ message }) => message,
    },
  },
});
```

The object key, `echo`, is the operation's ID. `handle` runs on your Overmux server machine and returns the message it receives.

### Input and output

Use [Zod schemas](https://zod.dev/) to define the input an operation accepts and the result it returns. Here, `echo` accepts an object with a `message` string and returns that string unchanged.

Handlers can be asynchronous, so you can run commands, access files, or call other services before returning a result.

### Handler API

The `handle` function receives the operation's input and a `context` object:

```ts
handle: async (input, context) => {
  // Run your server-side logic here.
},
```

`context` provides:

- **`invalidate(resourceId, input?)`**: tells clients to read an affected resource again after you change server-side data. See [Invalidating resources](./100-resources.md#invalidating-resources).
- **[`notifications.send(...)`](./400-notifications.md)**: sends a notification through Overmux.

See [Server API](./500-api.md#handler-context) for the full handler context.

## Calling operations from your Overmux UI

Create typed hooks with `createOvermuxHooks` from `overmux/client`:

```ts
// hooks.ts
import { createOvermuxHooks } from "overmux/client";
import type { serverConfig } from "./server";

export const { useOperation } = createOvermuxHooks<typeof serverConfig>();
```

The type-only import provides type checking without including server code in the browser.

Use the hook inside a component under your Overmux provider:

```tsx
import { useOperation } from "./hooks";

const EchoButton = () => {
  const echo = useOperation({ id: "echo" });

  return (
    <button onClick={() => echo.mutate({ message: "Hello world" })}>
      Echo message
    </button>
  );
};
```

Pass the operation's input to `mutate`.

Use `mutateAsync` when you need to await the result:

```ts
const message = await echo.mutateAsync({ message: "Hello world" });
```

See [Client API](../600-client/100-api.md) for operation hooks, pending state, errors, and results.

## Calling operations from the CLI

Call an operation by its ID and pass input as JSON:

```sh
overmux call echo --input '{"message":"Hello world"}'
```

The CLI prints the returned result as JSON:

```json
"Hello world"
```

Agents can use the same CLI commands to call your operations.

## How operations work

Each call sends an HTTP `POST` to `/api/operations/{operationName}`, with any input encoded as JSON.

Overmux handles authentication, validates the input, and calls your handler. If an output schema is defined, Overmux validates the result before returning it.

Unlike resource subscriptions, an operation is a single request and response. It returns a result or an error; it does not keep listening for updates.
