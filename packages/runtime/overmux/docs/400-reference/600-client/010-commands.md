---
title: Commands
---

Commands let you centralize a collection of named actions in your Overmux UI, such as “Close pane” or “Open settings”, so you can build a command palette, menu, or similar feature. They could also be triggered by [keyboard shortcuts](./shortcuts) or buttons.

Packages may also provide commands that you can use in your UI.

## Registering a command

Declare a command with `defineCommandRegistry`, then register its behavior inside a React component with `useCommand`.

### Basic registration

The handler can access the component’s state:

```tsx
import { useState } from "react";
import {
  defineCommandRegistry,
  defineOvermuxClient,
  useCommand,
} from "overmux/client";
import type { serverConfig } from "./server";

const commands = defineCommandRegistry<typeof serverConfig>()({
  openSettings: {
    title: "Open settings",
  },
});

const App = () => {
  const [settingsOpen, setSettingsOpen] = useState(false);

  useCommand(commands.openSettings, {
    run: () => setSettingsOpen(true),
  });

  return settingsOpen ? <Settings /> : <Workspace />;
};

export const client = defineOvermuxClient({
  commands,
  component: App,
});
```

`openSettings` is the command’s ID; `title` is its display name. `Settings` and `Workspace` represent your own components.

The handler is registered while `App` is mounted and removed when it unmounts. Registration does not execute the command.

### Disabling a command

Set `enabled` to prevent execution while keeping the command registered and visible through `useCommands()`:

```tsx
useCommand(commands.openSettings, {
  enabled: !settingsOpen,
  run: () => setSettingsOpen(true),
});
```

`enabled` defaults to `true`.

### Passing parameters to a shared handler

Declare `params` with a Zod schema and provide `run` in the registry when the behavior can live outside React:

```tsx
import { z } from "zod";

const commands = defineCommandRegistry<typeof serverConfig>()({
  killTmuxPane: {
    title: "Kill pane",
    params: z.object({ paneId: z.string() }),
    run: ({ params, overmuxServerApi }) =>
      overmuxServerApi.executeOperation("killTmuxPane", params),
  },
});
```

This assumes your server defines a `killTmuxPane` operation accepting `{ paneId: string }`. The handler runs client-side and calls that server operation.

The component supplies the current values:

```tsx
useCommand(commands.killTmuxPane, {
  params: { paneId: pane.id },
});
```

Parameters are type-checked and validated before execution. A registration can supply its own `run` to override the shared handler; that local handler takes no arguments and can read component state directly.

### Conditional registration

Pass `skipToken` when a parameterized command’s required context is missing:

```tsx
import { skipToken } from "overmux/client";

useCommand(
  commands.killTmuxPane,
  pane ? { params: { paneId: pane.id } } : skipToken,
);
```

Unlike `enabled: false`, this skips registration entirely. Without another registration, the command will not appear in `useCommands()`. Keep the hook call unconditional.

### Registering a command in multiple components

Use `element` to associate each registration with a UI region:

```tsx
const paneRef = useRef<HTMLDivElement>(null);

useCommand(commands.killTmuxPane, {
  params: { paneId: pane.id },
  element: paneRef,
});

return <div ref={paneRef}>...</div>;
```

Import `useRef` from React. When the command is triggered, Overmux prefers the registration whose element contains keyboard focus. For nested elements, the innermost wins.

If none contains focus, the most recently registered handler wins. `element` is a preference, not a restriction; use `enabled` to control availability. If the selected registration is disabled, nothing runs.

### Adding keyboard shortcuts

Set `defaultBindings` on a command declaration to give it keyboard triggers. See [Shortcuts](./shortcuts) for bindings and client overrides.

## Listing all registered commands

Use `useCommands()` to build a menu or command palette with all your registered commands.

```tsx
import { useCommands } from "overmux/client";

const CommandMenu = () => {
  const commands = useCommands();

  return (
    <div>
      {commands.map((command) => (
        <button
          key={command.id}
          disabled={!command.enabled}
          onClick={() => void command.execute()}
        >
          {command.title}
        </button>
      ))}
    </div>
  );
};
```

Each entry exposes `id`, `title`, `bindings`, `enabled`, and `execute()`. The list includes disabled commands but excludes commands without a registration.

Each command appears once, even if multiple components register it. `execute()` selects the handler using the current focus and runs it only if enabled.

## Using commands from packages

Packages can export commands to include alongside your own:

```tsx
import { sourceControlCommands } from "@overmux/git/react";

export const client = defineOvermuxClient({
  commands: {
    ...commands,
    ...sourceControlCommands,
  },
  component: App,
});
```

Adding commands to the registry does not register their handlers. For this package, pass the commands to `SourceControlView`:

```tsx
<SourceControlView
  {...sourceControlProps}
  commandHandles={sourceControlCommands}
/>
```

The view registers handlers for navigating changed files and scrolling diffs. They then appear in `useCommands()` alongside your own registered commands.

Keep command IDs unique when combining registries, and pass the same command objects to the client and the component.
