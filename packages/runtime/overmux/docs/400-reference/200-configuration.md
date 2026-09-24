---
title: Configuration
---

## `overmux.config.ts`

Loaded from `$XDG_CONFIG_HOME/overmux/overmux.config.ts`, fallback: `~/.config/overmux/overmux.config.ts`. Override with `--config /another/overmux.config.ts`. See [storage locations](/docs/reference/storage-locations).

### `server`

```ts
import { defineOvermuxConfig, defineOvermuxServer } from "overmux";

export default defineOvermuxConfig({
  // ...other config

  // Required.
  // Your server's resources, operations, and streams.
  // Shown inline; prefer defining and exporting this from ./server.ts.
  server: defineOvermuxServer({
    resources: {},
    operations: {},
    streams: {},
  }),
});
```

See [Server](/docs/reference/server).

### `auth`

```ts
import { defineOvermuxConfig } from "overmux";

export default defineOvermuxConfig({
  // ...other config

  // Required.
  // Configure client authentication.
  auth: {
    // Required. Only supported mode: "cli-login".
    // Authenticate clients using credentials created by the CLI.
    mode: "cli-login",

    // Default: the server's local origin.
    // Allowed browser origins. Non-loopback origins require HTTPS.
    origins: ["http://localhost:4242"],

    // Default: "forever".
    // Session lifetime: "forever" or a positive whole number with m, h, or d.
    // For example: "30m", "24h", or "30d".
    sessionLifetime: "forever",

    // Default: unset; proxy headers are not trusted.
    // Loopback IP of the reverse proxy allowed to supply forwarded headers.
    trustedProxyPeer: "127.0.0.1",
  },
});
```

See [`overmux auth`](/docs/reference/cli/auth) for creating and managing credentials.

### `host`

```ts
import { defineOvermuxConfig } from "overmux";

export default defineOvermuxConfig({
  // ...other config

  // Default: "localhost".
  // Network address to listen on.
  host: "localhost",
});
```

See [`overmux serve`](/docs/reference/cli/serve) for command-line overrides.

### `port`

```ts
import { defineOvermuxConfig } from "overmux";

export default defineOvermuxConfig({
  // ...other config

  // Default: 4242.
  // Listening port; an integer from 1-65535.
  port: 4242,
});
```

See [`overmux serve`](/docs/reference/cli/serve) for command-line overrides.

### `instanceId`

```ts
import { hostname } from "node:os";
import { defineOvermuxConfig } from "overmux";

export default defineOvermuxConfig({
  // ...other config

  // Optional custom identity: a fixed ID or a function of the listening port.
  // Default instance ID:
  instanceId: ({ port }) => `${hostname()}-${port}`,
});
```

IDs must be 1-253 lowercase ASCII characters, start and end with a letter or digit, and contain only letters, digits, dots, or hyphens. Explicit IDs are validated, not normalized. Set an explicit ID if the machine hostname does not meet these rules.

An ID function runs once at startup using the actual listening port. Every address serving the same running instance reports the same ID. Distinct instances need distinct IDs; IDs are not credentials.

See [Deep links](./600-client/007-deep-links.md) and [`overmux instance`](/docs/reference/cli/instance).

### `vite`

```ts
import { defineOvermuxConfig } from "overmux";

export default defineOvermuxConfig({
  // ...other config

  // No default; required by `overmux serve`.
  // Path to your application's Vite configuration.
  vite: "./vite.config.ts",
});
```

See [`overmux serve`](/docs/reference/cli/serve).

### `productionWebAssetsDir`

```ts
import { defineOvermuxConfig } from "overmux";

export default defineOvermuxConfig({
  // ...other config

  // No default; required by `overmux serve --production`.
  // Directory containing the built browser assets.
  productionWebAssetsDir: "./dist",
});
```

See [`overmux serve`](/docs/reference/cli/serve) for production serving.

### `watch`

```ts
import { defineOvermuxConfig } from "overmux";

export default defineOvermuxConfig({
  // ...other config

  // Default: true.
  // Watch application files and restart the development server on changes.
  watch: true,
});
```

See [`overmux serve`](/docs/reference/cli/serve) for development mode.

### `debug`

```ts
import { defineOvermuxConfig } from "overmux";

export default defineOvermuxConfig({
  // ...other config

  // Default: true.
  // Enable debug logging.
  debug: true,
});
```

See [Storage locations](/docs/reference/storage-locations) for the server log location.

### `aiContextSnippets`

```ts
import { defineOvermuxConfig } from "overmux";

export default defineOvermuxConfig({
  // ...other config

  // Default: ["package-source", "tech-stack-recommendations"].
  // Select guidance emitted by `overmux docs ai-context`; [] emits no context.
  aiContextSnippets: ["package-source", "tech-stack-recommendations"],
});
```

See [`overmux docs ai-context`](/docs/reference/cli/docs#overmux-docs-ai-context) for setup instructions and snippet descriptions.

## `overmux.desktop.ts`

Loaded from `$XDG_CONFIG_HOME/overmux/overmux.desktop.ts`, fallback: `~/.config/overmux/overmux.desktop.ts`. A missing file uses the defaults.

Desktop configuration is trusted TypeScript, loaded once at startup. Restart the desktop app after changes. Use `--desktop-config <path>` to load another file.

### `titleBar`

```ts
import { defineOvermuxDesktopConfig } from "@overmux/desktop";

export default defineOvermuxDesktopConfig({
  // ...other config

  // Default: "hidden". Options: "hidden", "native".
  // Show or hide the native window title bar.
  titleBar: "hidden",
});
```

### `menuBar`

```ts
import { defineOvermuxDesktopConfig } from "@overmux/desktop";

export default defineOvermuxDesktopConfig({
  // ...other config

  // Default: "auto-hide". Options: "auto-hide", "hidden", "visible".
  // Control the Linux/Windows window menu; auto-hide reveals it with Alt.
  // Does not affect the macOS global menu.
  menuBar: "auto-hide",
});
```

### `macosTitleBarStyle`

```ts
import { defineOvermuxDesktopConfig } from "@overmux/desktop";

export default defineOvermuxDesktopConfig({
  // ...other config

  // Default: unset; follows titleBar. Options: "native", "transparent".
  // Override titleBar on macOS; transparent extends content into its area.
  macosTitleBarStyle: "transparent",
});
```

### `macosTrafficLights`

```ts
import { defineOvermuxDesktopConfig } from "@overmux/desktop";

export default defineOvermuxDesktopConfig({
  // ...other config

  // Default: "hidden". Options: "hidden", "visible".
  // Show or hide the macOS close, minimize, and zoom buttons.
  macosTrafficLights: "hidden",
});
```
