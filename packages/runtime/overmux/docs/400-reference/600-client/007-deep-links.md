---
title: Deep links
---

Your Overmux UI is a website, so each page has a URL. Deep links let you open those same routes in a specific Overmux instance using `overmux://` instead of an `http://` web address.

```text
overmux://work-laptop/my-page?tab=logs
          instance   UI route
```

## Instances

An **instance** is one Overmux server. Its ID defaults to `<hostname>-<port>`. Set [`instanceId`](../200-configuration.md#instanceid) in `overmux.config.ts` to give it a stable identity.

The instance ID is not a network address. Desktop remembers how to reach an instance when you connect to it.

Run [`overmux instance --json`](../700-cli/350-instance.md) to get the running server’s `instanceId` and `deepLinkPrefix`.

## Creating links

Append your Overmux UI’s route to the instance’s deep-link prefix.

Server handlers receive `instance` through their context argument:

```ts
import { defineOperation } from "overmux/server";
import { z } from "zod";

export const getPageLink = defineOperation({
  input: z.void(),
  output: z.string(),
  handle: (_input, { instance }) =>
    `${instance.getDeepLinkPrefix()}/my-page?tab=logs`,
});
```

In React, use `useInstance` from your `createOvermuxHooks` setup. It re-renders when the server’s identity becomes available or changes:

```tsx
import { useInstance } from "./overmux";

const PageLink = () => {
  const instance = useInstance();
  if (!instance) return null;

  return (
    <a href={`${instance.deepLinkPrefix}/my-page?tab=logs`}>
      View logs
    </a>
  );
};
```

`useInstance()` returns `undefined` until the server identifies itself.

## Routing in your Overmux UI

Your Overmux UI owns routing. We recommend [TanStack Router](https://tanstack.com/router/latest) for routing with React. See [Tech stack recommendations](./300-tech-stack-recommendations.md).

Overmux passes the path, query, and fragment to your client’s `navigate` callback. Connect this callback to your router to navigate without reloading the page. Without that callback, Overmux loads the route normally.

With an existing TanStack Router instance exported from `./router`:

```tsx
import { RouterProvider } from "@tanstack/react-router";
import { defineOvermuxClient } from "overmux/client";
import { router } from "./router";

const App = () => <RouterProvider router={router} />;

export const client = defineOvermuxClient({
  commands: {},
  component: App,
  navigate: (route) => router.navigate({ href: route }),
});
```

For `overmux://work-laptop/my-page?tab=logs#latest`, `route` is `/my-page?tab=logs#latest`.

## Opening links

- **Inside your Overmux UI or PWA:** same-instance links navigate locally. No OS protocol handler is needed.
- **Desktop:** opening a link launches or focuses Desktop. Links can also switch to another known instance after confirmation. Connect to that instance first so Desktop knows its address.
- **Browser/PWA:** links to different or not-yet-discovered instances are blocked.

Installing the PWA does not register it as an OS-wide `overmux://` handler. Links clicked outside your Overmux UI require Overmux Desktop.
