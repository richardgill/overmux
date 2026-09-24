# Overmux

Overmux is a local or self-hosted web UI for tmux sessions, Pi agents, and Git workspaces.

## Local environment

Normal development and `pnpm local-ci` do not require maintainer credentials. Website analytics are optional: `PUBLIC_POSTHOG_KEY` is a public ingestion key; `POSTHOG_OVERMUX_PERSONAL_API_KEY` is a secret used only for maintainer API queries. Use your own PostHog project and keep personal API keys out of browser configuration and Git.

Maintainers who use 1Password can optionally run `pnpm setup-local-dot-env`. Configure `OP_ACCOUNT`, `OP_VAULT`, and `OP_OVERMUX_SECRETS_ITEM` for your own item, with environment-variable names as field labels. The defaults are account `my.1password.com`, vault `Private`, and item `Overmux Secrets Local`; these are conventions, not shared contributor credentials.

The command generates an owner-readable `../.env.shell` for sibling worktrees; set `OP_ENV_SHELL_OUTPUT` to choose another path. Source it explicitly in your shell and optionally source a private `../.env.local.shell` afterward for overrides. Rerun the generator after changing the item. Never commit generated credentials.

## Desktop development host

The Electron host in [`apps/desktop`](./apps/desktop) connects to an independently installed Overmux server and renders it in a secure desktop window. Set `OVERMUX_SERVER_URL` to connect directly, or configure an instance in the app. Run it with `nix run .#overmux-desktop` on NixOS or `pnpm --filter @overmux/desktop dev` elsewhere. Linux x86_64 releases provide an AppImage and Debian package without a bundled server or auto-updater; see the [desktop README](./apps/desktop/README.md#linux-packages).

## Configuration

Overmux uses an application config, a trusted server composition root, and a browser client:

```text
overmux.config.ts   trusted server startup configuration
src/server/index.ts backends, resources, streams, operations, and permissions
src/ui/index.html   browser document and viewport setup
src/ui/app.tsx      browser application definition
src/ui/main.tsx     browser UI entry point
vite.config.ts      standard Vite plugins and build settings
```

Run `overmux init` to create this minimal application in `$XDG_CONFIG_HOME/overmux`, install its dependencies, and validate it. The default config path is `$XDG_CONFIG_HOME/overmux/overmux.config.ts`. Pass `--config <path>` to override it.

Run `overmux serve` for development. Overmux exposes the only public listener and places private loopback Vite behind the authenticated HTTP and HMR gateway. Use `overmux serve --production` to build and serve the production application, or add `--no-build` to serve existing output.

Pass `--debug` to write structured server and browser diagnostics to stderr and `$XDG_STATE_HOME/overmux/overmux.log` (falling back to `~/.local/state/overmux/overmux.log`). Browser diagnostics use the runtime WebSocket and omit operation payloads and terminal stream data.

### Application

```ts
import { defineOvermuxConfig } from "overmux";
import server from "./overmux.server";

export default defineOvermuxConfig({
  auth: { mode: "cli-login" },
  host: "localhost",
  port: 4242,
  productionWebAssetsDir: "./dist",
  server,
  vite: "./vite.config.ts",
});
```

`vite` and `productionWebAssetsDir` resolve relative to `overmux.config.ts`. `--host` and `--port` override only the public listener. When `auth.origins` is omitted, Overmux infers `http://<host>:<port>` after binding. Configure exact browser origins and an explicit trusted loopback proxy for HTTPS termination; see [`packages/runtime/overmux/docs/400-reference/200-configuration.md`](./packages/runtime/overmux/docs/400-reference/200-configuration.md).

The Vite config is ordinary userland and does not install an Overmux plugin:

```ts
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist" },
  plugins: [viteReact()],
});
```

### Server

```ts
import { defineOvermuxServer } from "overmux";
import {
  defineGitRepositories,
  gitOperationHandlers,
  gitSourceControlResource,
} from "overmux/git/server";
import { defineResourceContract, noInputSchema } from "overmux";
import {
  defineTmuxControlBackend,
  tmuxOperations,
  tmuxResource,
  tmuxStream,
} from "@overmux/tmux/server";
import { z } from "zod";

const tmux = defineTmuxControlBackend({
  id: "local",
  socket: "default",
});
const repositories = defineGitRepositories({
  allowedRoots: ["/home/user/code"],
  permissions: { applyPatch: true, discard: true, stage: true, unstage: true },
});
const workspaceContract = defineResourceContract({
  input: noInputSchema,
  output: z.object({ tmux: z.unknown() }),
});

export default defineOvermuxServer({
  resources: {
    tmux: tmuxResource({ backend: tmux }),
    workspaceState: {
      kind: "derived",
      contract: workspaceContract,
      dependencies: { tmux: "tmux" },
      combine: ({ tmux }) => ({ tmux }),
    },
    sourceControl: gitSourceControlResource({ repositories }),
  },
  streams: {
    tmux: tmuxStream({
      allowInput: true,
      backend: tmux,
      geometryPolicy: "shared",
    }),
  },
  operations: {
    ...tmuxOperations({ backend: tmux }),
    ...gitOperationHandlers({ repositories, resourceId: "sourceControl" }),
  },
});
```

`useTmuxTerminal({ stream })` owns the connection and exposes `goTo(target)` plus the server-confirmed `location`. Pass its result to `<TmuxXterm terminal={terminal} />`. Navigation reuses the same full-window tmux client and renderer; configure xterm scrollback through its `options` prop.

The terminal stream starts one server-side PTY and dedicated tmux client for an explicit navigation request, even without a renderer. Its default dimensions initially use tmux's `ignore-size` flag so headless navigation cannot resize existing windows. After the renderer reports its size, `geometryPolicy: "shared"` lets browser dimensions participate in normal shared-window sizing; `"ignore-size"` keeps excluding them. Browser and physical clients share active windows, active panes, and status options. Tmux supplies redraw bytes, while rendered acknowledgements provide bounded output flow control.

Object keys are stable typed IDs. Resources are queries, subscriptions, or synchronous derived snapshots. Streams are separate long-lived channels. Backends are bound server-side, so calls use local `paneId`, `agentId`, and path inputs without repeating backend identities.

`overmux.server.ts` contains trusted app behavior only. The browser application is an ordinary Vite application, independently owned by the user.

### Client

```tsx
import {
  createOvermuxHooks,
  defineCommandRegistry,
  defineOvermuxClient,
  useCommandTarget,
} from "overmux/client";

import { TmuxXterm, useTmuxTerminal } from "@overmux/tmux/react";

type ServerConfig = typeof import("./overmux.server").default;

const { useOperation, useResource, useStream } =
  createOvermuxHooks<ServerConfig>();
const commands = defineCommandRegistry({
  reloadTmux: {
    title: "Reload tmux",
    defaultBindings: [["F12", "Shift+R"]],
  },
});

const App = () => {
  const workspace = useResource({ id: "workspaceState" });
  const stream = useStream({ id: "tmux" });
  const terminal = useTmuxTerminal({ stream });
  const reloadTmux = useOperation({ id: "reloadTmuxConfig" });
  useCommandTarget(commands.reloadTmux, {
    run: () => reloadTmux.mutateAsync(),
  });

  return (
    <main>
      <button onClick={() => reloadTmux.mutate()}>Reload tmux</button>
      <button
        onClick={() =>
          terminal.goTo({ sessionId: "$1" }).catch(console.error)
        }
      >
        Select session
      </button>
      <button onClick={() => terminal.input("pwd\r")}>Send input</button>
      <output>{terminal.location?.paneId}</output>
      <button onClick={() => stream.close()}>Close terminal</button>
      <div style={{ height: "60vh", display: "flex", flexDirection: "column" }}>
        <TmuxXterm terminal={terminal} style={{ minWidth: 0 }} />
        {terminal.error ? <div role="alert">{terminal.error.message}</div> : null}
      </div>
      <pre>{JSON.stringify(workspace.data, null, 2)}</pre>
    </main>
  );
};

export const client = defineOvermuxClient({
  appearance: { scheme: "dark", contrast: "auto" },
  commands,
  component: App,
});
```

Mount that definition in the Vite entry point:

```tsx
import { OvermuxHost } from "overmux/client";
import { createRoot } from "react-dom/client";
import { client } from "./app";

createRoot(document.querySelector("#root")!).render(
  <OvermuxHost definition={client} />,
);
```

`OvermuxHost` always mounts Overmux lifecycle and recovery UI, including reload, restart, and reconnection states. The application controls its page markup and styling; the host renders those safeguards independently. Overmux also owns the authenticated `/_overmux/settings` and `/_overmux/logout` pages above the userland router.

`appearance` selects the root client `OvermuxThemeScope` scheme (`"light"`, `"dark"`, or `"system"`) and contrast (`"normal"`, `"high"`, or `"auto"`). It deliberately accepts no color tokens: visual token values remain CSS-only.

`OvermuxThemeScope` is the public visual boundary for a subtree. It supplies `data-om-scope`, `data-om-scheme`, `data-om-contrast`, and an overlay root, so use it when an embedded view needs an independent theme or portal boundary. `OvermuxPortal` renders overlays beneath the nearest theme scope. `OvermuxHost` is the public runtime host.

The server type import is type-only and trusted code is not bundled into the browser. IDs infer resource input/output, operation input/output, and stream input/message types. No-input resources use `useResource({ id: "workspaceState" })`; no-input operations use `mutate()` or `mutateAsync()` without dummy objects. Resource caching and operation state use TanStack React Query.

`defineCommandRegistry` is the single semantic command catalogue. Titles and default bindings stay together, while `useCommandTarget(handle, target | skipToken)` registers the active context-specific implementation used by both keyboard dispatch and command palettes.

### Operations and notifications

Operations expose typed synchronous HTTP request/response handlers. They can invalidate resources immediately and send notifications:

```ts
export default defineOvermuxServer({
  operations: {
    taskFinished: {
      input: z.object({ task: z.string(), workspace: z.string() }),
      handle: async (input, { notifications }) =>
        notifications.send({
          body: input.task,
          open: { link: `/workspaces/${input.workspace}` },
          title: "Task finished",
        }),
    },
  },
  resources: {},
});
```

Invalidate a resource using its key in `resources`, not its contract: `context.invalidate("ls")` refreshes all subscribed inputs, while `context.invalidate("ls", { path: "/" })` targets one parsed input. Inline handlers type-check resource IDs and raw inputs; derived resources depending on that resource are invalidated too. Unknown IDs still throw at runtime. See [operations](./packages/runtime/overmux/docs/400-reference/500-server/200-operations.md) for reusable-handler requirements.

Invoke a named operation through HTTP with JSON input:

```sh
overmux call taskFinished --port 4242 --input '{"task":"Run tests","workspace":"main"}'
```

Connected browsers and Electron receive notifications live. Browsers can call `enableBackgroundNotifications()` or use the browser notification controls in Overmux settings to continue receiving them while disconnected; `disableBackgroundNotifications()` removes that browser endpoint. Signing keys and subscriptions persist under `$XDG_DATA_HOME/overmux/background-notifications/`, falling back to `~/.local/share/overmux/background-notifications/`.

Clicking safely focuses the app, opens relative and same-origin links in Overmux, and opens cross-origin HTTP(S) links in the system browser. Background delivery uses the browser's Web Push standard internally.

## Focused React exports

- `@overmux/tmux/client` exports the renderer-neutral `createTmuxTerminalClient`.
- `@overmux/tmux/react` exports the headless `useTmuxTerminal` hook and thin `TmuxXterm` terminal adapter. Applications own error messages and close controls.
- `overmux/pi/react` exports `PiConversation` and `PiMessageComposer`.
- `overmux/git/react` exports `GitChangesSidebar`, `GitDiff`, `SourceControlView`, and opt-in `sourceControlCommands`.
- `overmux/client` exports `OvermuxThemeScope`, typed hooks, and commands.
- `@overmux/ui` exports reusable layout primitives such as `SplitView`.

Spread `sourceControlCommands` into the client command registry and pass the same object to `SourceControlView.commandHandles` to opt into file and hunk commands. Bindings remain client configuration; command targets unregister with the view and can be disabled with `active={false}`.

## CSS cascade layers

The `overmux/client` stylesheet establishes the global layer order `theme, base, om` whenever `OvermuxHost` is bundled. First-party component defaults live in `om.components` and use native `@scope` with low-specificity selectors, so they cannot style outside their component and framework theme and reset layers apply first. Define theme tokens such as `--om-color-canvas` and `--om-color-accent` in CSS, preferably in `@layer theme`; do not put token values in client TypeScript configuration. Runtime markup uses semantic `data-om-*` attributes rather than an ID-based root contract. Browser clients require `@scope` support: Chrome 118+, Safari 17.4+, or Firefox 146+.

## Transport and trust boundary

HTTP serves the runtime manifest, static production assets, synchronous operation requests, restart requests, background-notification controls, and the WebSocket upgrade. The runtime manifest describes the current server runtime's protocol version, registered names, and debug setting; it is data, not negotiation or executable config. One WebSocket carries resource reads and invalidations, streams, notifications, diagnostics, and update/restart events. Inputs and outputs are validated with the configured Zod schemas. Resources, streams, and operations use their configured names across browser and server transports.

Shell access to the server machine is the authentication root of trust. The owner-only control socket issues single-use browser login grants and short-lived bearer credentials for local CLI calls. Browsers use opaque HttpOnly cookies with exact-origin protection; bearer and cookie sessions are deliberately non-interchangeable.

Only health, authentication state, and login exchange are public. Runtime APIs, production assets, WebSockets, and session-owned background notifications share the authenticated boundary. Session revocation closes associated WebSockets and removes background-notification subscriptions.

`overmux` is the browser-neutral authoring surface, and `overmux/client` owns browser and React APIs. `overmux/server` remains an empty entry point with no public APIs. Use the CLI to start the server or check configuration. Runtime protocols, validation, compilation, transports, and execution stay private to the package. `@overmux/pty` is Node-only and exposes only `@overmux/pty/server`. Absolute Git paths are accepted only after canonical allowed-root authorization.

## Pi integration

`@overmux/pi` remains both the published Pi extension and the Overmux server integration. Install the extension with:

```sh
pi install npm:@overmux/pi
```

`overmux/pi/server` exports dynamic `definePiAgents`, `piConversationStream`, `piOperationHandlers`, and the Pi sessions resource. Session discovery is supplied by user configuration and can refresh agents without restarting the server process. See [`packages/ecosystem/pi/README.md`](./packages/ecosystem/pi/README.md).

## Checking configuration

```sh
overmux check [--config <path>] [--watch] [--json] [--types-only]
```

Normal checking typechecks reachable config, server, and shared modules, then validates the server configuration. `--types-only` skips trusted execution.

## Development

```sh
pnpm install
pnpm local-ci
```

Playwright tests are separate: `pnpm test:e2e`.

See [`AGENTS.md`](./AGENTS.md) for repository architecture and conventions.

## License

Original Overmux code is [MIT licensed](./LICENSE), copyright Richard Gill. Third-party code and assets retain their own licenses and attribution; see package-local `THIRD_PARTY_NOTICES.md` files and the xterm fork's upstream license.
