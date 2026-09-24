---
title: JSONL store
---

`@overmux/jsonl-store` is a simple way to store JSON records in a flat [`.jsonl` file](https://jsonlines.org/).

Example:

```jsonl title="~/.local/share/overmux/events.jsonl"
{"message":"hello","timestamp":1700000000000}
{"message":"world","timestamp":1700000001000}
```

## Installation

```sh
cd ~/.config/overmux
pnpm add @overmux/jsonl-store zod
```

## Usage

In your Overmux server code, first create the store:

```ts
import { join } from "node:path";
import { createJsonlStore } from "@overmux/jsonl-store/server";
import { getOvermuxPaths } from "overmux/server";
import { z } from "zod";

const eventSchema = z.object({
  message: z.string(),
  timestamp: z.number(),
});

const eventsStore = createJsonlStore({
  path: join(getOvermuxPaths().dataDir, "events.jsonl"), // ~/.local/share/overmux/events.jsonl
  schema: eventSchema,
});
```

Then append new records:

```ts
await eventsStore.append({
  message: "Started",
  timestamp: Date.now(),
});
```

The file and any missing parent directories are created automatically on the first append.

Retrieve all records with:

```ts
const events = await eventsStore.getAll();
```

## Expose records to the client

You can expose your store's records using an [Overmux resource](/docs/reference/server/resources):

```ts title="overmux.server.ts"
import { join } from "node:path";
import { createJsonlStore } from "@overmux/jsonl-store/server";
import {
  defineOvermuxServer,
  defineResourceContract,
  noInputSchema,
} from "overmux";
import { getOvermuxPaths } from "overmux/server";
import { z } from "zod";

const eventSchema = z.object({
  message: z.string(),
  timestamp: z.number(),
});

const eventsStore = createJsonlStore({
  path: join(getOvermuxPaths().dataDir, "events.jsonl"), // ~/.local/share/overmux/events.jsonl
  schema: eventSchema,
});

export default defineOvermuxServer({
  resources: {
    events: {
      kind: "query",
      contract: defineResourceContract({
        input: noInputSchema,
        output: z.array(eventSchema).readonly(),
      }),
      read: () => eventsStore.getAll(),
    },
  },
});
```

Then read it from your client:

```tsx title="Events.tsx"
import { createOvermuxHooks } from "overmux/client";
import type server from "./overmux.server";

const { useResource } = createOvermuxHooks<typeof server>();

export const Events = () => {
  const events = useResource({ id: "events" });

  if (events.status === "error") return <p>Could not load events.</p>;
  if (events.status !== "success") return <p>Loading…</p>;

  return (
    <ul>
      {events.data.map((event, index) => (
        <li key={index}>{event.message}</li>
      ))}
    </ul>
  );
};
```
