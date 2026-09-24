---
title: Resources
---

Resources expose server-side data to your Overmux UI. 

There are three kinds of resource: [query](#query), [subscription](#subscription), and [derived](#derived).

## Query

Query resources read server-side data on request.

For example, to run `ls /` on your server and expose the result:

```ts
// server.ts
defineOvermuxServer({
  resources: {
    ls: {
      kind: "query",
      contract: defineResourceContract({
        input: noInputSchema,
        output: z.array(z.string()),
      }),
      read: async () => {
        const { stdout } = await execFileAsync("ls", ["/"]);
        return stdout.split("\n").filter(Boolean);
      },
    },
  },
});
```

See [Accessing resources from your Overmux UI](#accessing-resources-from-your-overmux-ui) to display the listing in React.

## Subscription

Subscription resources read server-side data and notify clients when it changes.

To keep the `ls /` listing up to date, watch the directory for changes:

```ts
import { watch } from "node:fs";

// server.ts
defineOvermuxServer({
  resources: {
    ls: {
      kind: "subscription",
      contract: defineResourceContract({
        input: noInputSchema,
        output: z.array(z.string()),
      }),
      read: async () => {
        const { stdout } = await execFileAsync("ls", ["/"]);
        return stdout.split("\n").filter(Boolean);
      },
      subscribe: (_input, invalidate) => {
        // Watch the root directory for filesystem changes.
        const watcher = watch("/", () => {
          // Tell Overmux the data may have changed so it reads it again.
          invalidate();
        });
        // Subscription cleanup function.
        return () => watcher.close();
      },
    },
  },
});
```

When the subscription ends, Overmux calls the cleanup function returned by `subscribe`. In this example, it closes the filesystem watcher.

The React code stays the same: `useResource({ id: "ls" })`.

## Derived

Derived resources compute a value from other resources.

For example, count the entries returned by the `ls` resource above. Add `entryCount` alongside `ls` in your `resources` object:

```ts
defineOvermuxServer({
  resources: {
    ls: {
      // The subscription resource above:
      // reads ls / and watches for directory changes.
    },
    entryCount: {
      kind: "derived",
      contract: defineResourceContract({
        input: noInputSchema,
        output: z.number(),
      }),
      dependencies: { ls: "ls" },
      combine: ({ ls }) => ls.length,
    },
  },
});
```

`dependencies` maps the names used in `combine` to resource IDs. Here, `combine` receives the value of `ls` and returns its length.

If `ls` returns `["bin", "etc", "home"]`, `entryCount` returns `3`. With the subscription version of `ls`, the count updates when the directory listing changes.

Access it from your UI with `useResource({ id: "entryCount" })`.

## Accessing resources from your Overmux UI

Use `useResource` to access query, subscription, and derived resources. Create your typed hooks with `createOvermuxHooks` from `overmux/client`:

```ts
// hooks.ts
import { createOvermuxHooks } from "overmux/client";
import type { serverConfig } from "./server";

export const { useResource } = createOvermuxHooks<typeof serverConfig>();
```

Here, `serverConfig` is the exported result of `defineOvermuxServer`. The type-only import provides type checking without including your server code in the browser.

Use the hook inside a component under your Overmux provider:

```tsx
import { useResource } from "./hooks";

const DirectoryListing = () => {
  const ls = useResource({ id: "ls" });

  if (ls.status === "pending") return <p>Loading...</p>;
  if (ls.status === "error") return <p>{ls.error.message}</p>;

  return (
    <div>
      {ls.data.map((name) => (
        <div key={name}>{name}</div>
      ))}
    </div>
  );
};
```

The same component works with either `ls` example above. Overmux handles reads and change notifications, updating your component when fresh data arrives.

See [Client API: Resources](../600-client/100-api.md#resources) for input arguments, return values, and manual refreshes.

## Invalidating resources

After server-side data changes, call `invalidate()` to tell clients: **“Your data may be out of date. Read this resource again.”**

Clients will request the data by calling the resource's `read` function again.

### From a subscription

Call the `invalidate` callback provided to `subscribe` when your watcher detects a change:

```ts
subscribe: (_input, invalidate) => {
  const watcher = watch("/", () => {
    // Tell clients to read the directory listing again.
    invalidate();
  });

  return () => watcher.close();
},
```

### From an operation

After changing server-side state in an [operation](./200-operations.md), call `context.invalidate(resourceId)`:

```ts
handle: async ({ path }, context) => {
  await mkdir(path);

  // Refresh clients using the directory listing resource.
  context.invalidate("ls");
},
```

Pass the resource's key in `resources`. Here, `"ls"` identifies the directory listing.

Omit the second argument to invalidate all inputs. For a resource that accepts input, pass it to refresh only matching data: `context.invalidate("files", { path: "/" })`.

## How resources work

Resources communicate over a persistent WebSocket connection between your browser and server. This connection lets the client request data and the server send change notifications.

When you call `useResource`, the client requests the resource's value. For subscription resources, it also listens for change notifications.

Calling `invalidate()` tells the client its data may be stale. It does not send the updated value; the client requests a fresh read, and React updates with the result.
