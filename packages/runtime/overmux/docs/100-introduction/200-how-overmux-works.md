---
title: How Overmux Works
---

Overmux lets you build your own customized dev environment by writing TypeScript server code for Node.js and React components for your browser UI.

Run `overmux serve` on your dev machine to expose your dev environment in the browser on localhost:4242.

## The Overmux server

`overmux serve` runs your server-side Node.js code and serves your React UI, bundled using [Vite](https://vite.dev/).

Overmux server code is organized around three concepts:

### Resources

Resources expose server-side data from your dev machine, making them available in your UI.

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

Later in React:

```tsx
const ls = useResource({ id: "ls" });

return (
  <div>
    {ls.data?.map((name) => (
      <div key={name}>{name}</div>
    ))}
  </div>
);
```

Resources have three modes: **query** reads data on request, **subscription** adds change notifications, and **derived** computes a value from other resources. See [resources docs](../400-reference/500-server/100-resources.md) for more details.

### Operations

Operations are "calls" you can make to your server code.

For example:

```ts
defineOvermuxServer({
  operations: {
    helloWorld: defineOperation({
      input: noInputSchema,
      handle: () => console.log("Hello world"),
    }),
  },
});
```

Trigger it from React:

```tsx
const helloWorld = useOperation({ id: "helloWorld" });

return <button onClick={() => helloWorld.mutate()}>Say hello</button>;
```

Or run `overmux call helloWorld` on your server. This also allows your agents to call Overmux operations.

Operations can run your server-side code, invalidate resources, or send notifications using `notifications.send()`.

See [Operations](../400-reference/500-server/200-operations.md) for defining and calling operations.

### Streams

Streams are high throughput bidirectional streams. They're used when latency and throughput are important.

Examples:
- Connecting to tmux
- Streaming AI Agent output

See [Streams](../400-reference/500-server/300-streams.md) for defining and consuming streams.

### Ecosystem packages

Overmux's resource, operation, and stream APIs let the community publish npm packages for common development tasks.

## The Overmux client

The Overmux client is a website built with React and TypeScript (TSX), bundled using [Vite](https://vite.dev/).

See [Client](../400-reference/600-client/000-index.md) for defining your browser application.

## Authentication

Overmux handles authentication for you. This is important because most overmux setups give sensitive access to your dev machine.

Run `overmux serve` and then `overmux auth login` to get a login code or a link to instantly login.

See [Authentication and Security](../400-reference/400-authentication-and-security.md) for more details.

## Technology choices

### Mandatory

- **[Node.js](https://nodejs.org/)** runs your server code and the Overmux CLI.
- **[TypeScript](https://www.typescriptlang.org/)** provides type checking across your server and UI. This is the expected development workflow; Overmux does not require you to run `tsc` before serving.
- **[React and React DOM](https://react.dev/)** render your UI.
- **[Vite](https://vite.dev/)** serves your UI during development and builds it for production.
- **[Zod](https://zod.dev/)** defines and validates your API's input and output schemas.

### Recommended

- **[Mise](https://mise.jdx.dev/)** manages developer tools and their versions; `overmux init` uses it when installed and activated.
- **[pnpm](https://pnpm.io/)** manages application dependencies; required by `overmux init`.


You can use any other npm packages you like. You can make your own choices for routing, styling, and component libraries. See [tech stack recommendations](../400-reference/600-client/300-tech-stack-recommendations.md) for some recommendations if you're new to building for the web.
