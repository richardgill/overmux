---
title: "`overmux init`"
---

Create a minimal, runnable Overmux application without prompting.

```sh
overmux init
```

The application is created in `$XDG_CONFIG_HOME/overmux` (default `~/.config/overmux`). See [storage locations](../300-storage-locations.md) for directory defaults and overrides.

The command validates the toolchain before writing files. When Mise is installed, it must be [activated in the shell](https://mise.jdx.dev/getting-started.html#activate-mise); the generated `mise.toml` pins Node 22, pnpm 10, and the latest published Overmux version. Without Mise, pnpm 10 or newer must already be available and `mise.toml` is omitted.

The initializer pins the exact latest published `overmux` version in `package.json`, installs dependencies, generates `pnpm-lock.yaml`, and runs `overmux check`. Existing scaffold files cause the command to fail without changing them. Unrelated files are preserved.
