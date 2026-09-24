---
title: Install and Run Overmux
---

First you need to install the `overmux` CLI.

### Recommended: Install with Mise

[Mise](https://mise.jdx.dev) installs and manages developer tools and their versions.

1. [Install Mise](https://mise.jdx.dev/getting-started.html).

2. Install Overmux globally:

   ```bash
   mise use --global npm:overmux
   ```

### Alternatively: Install with pnpm

Prerequisites:

- [Node.js 22](https://nodejs.org/en/download) or newer
- [pnpm 10](https://pnpm.io/installation) or newer

Install Overmux globally:

```bash
pnpm add --global overmux
```

## Initialize Overmux

Once the CLI is installed, create your Overmux setup:

```bash
overmux init
```

This validates your toolchain, creates a minimal application in `$XDG_CONFIG_HOME/overmux` (default `~/.config/overmux`; see [storage locations](../400-reference/300-storage-locations.md)), installs its dependencies, and checks the result. Existing scaffold files are left unchanged. Read more in the [`overmux init` reference](../400-reference/700-cli/050-init.md) and [project structure](../400-reference/100-project-structure.md).

## Start the server

```bash
overmux serve
```

Open Overmux in your browser to confirm it works.

To configure hosts and ports, see [Configuration](../400-reference/200-configuration.md).
