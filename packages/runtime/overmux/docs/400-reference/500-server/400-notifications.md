---
title: Notifications
---

Send notifications from an [operation handler](./200-operations.md#handler-api) using `context.notifications.send()`. There is no separate notification API to import; Overmux provides it through the handler's `context`:

```ts
// server.ts
import { defineOperation, defineOvermuxServer, noInputSchema } from "overmux";

export const serverConfig = defineOvermuxServer({
  resources: {},
  operations: {
    myOperation: defineOperation({
      input: noInputSchema,
      handle: async (_input, context) => {
        await context.notifications.send({
          title: "Task finished",
          body: "Your results are ready.",
          open: { link: "/results" },
        });
      },
    }),
  },
});
```

- `title`: required, non-empty text.
- `body`: optional text.
- `open.link`: optional destination to open when the notification is activated. Use an app-relative path starting with `/` or an HTTP(S) URL without credentials.

Each text field and link has a maximum length of 4,096 characters. `send()` returns `Promise<void>`.
