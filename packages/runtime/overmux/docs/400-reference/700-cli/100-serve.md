---
title: "`overmux serve`"
---

Serve the authenticated Overmux web UI. Development starts private Vite behind the public Overmux gateway. Production builds with Vite and serves static assets without running Vite.

## Usage

```text
overmux serve [--config path] [--host host] [--port port] [--login | --no-login]
overmux serve --production [--no-build] [--config path] [--host host] [--port port] [--login | --no-login]
```

See [storage locations](../300-storage-locations.md) for default configuration paths, logs, and persistent data.

## Options

| Flag | Description | Default |
| --- | --- | --- |
| `--config <path>, -c <path>` | Configuration file | `$XDG_CONFIG_HOME/overmux/overmux.config.ts` |
| `--host <host>` | Override the public listener host | Configured host |
| `--port <port>` | Override the public listener port | Configured port |
| `--login` | Create and print a browser login grant after startup | Human terminal sessions |
| `--no-login` | Do not create a grant and print the `overmux auth login` command | Agent, CI, and non-interactive sessions |
| `--production` | Build and serve `productionWebAssetsDir` |  |
| `--no-build` | With `--production`, serve existing assets after checking `index.html` exists |  |

`--login` and `--no-login` are mutually exclusive. By default, a human terminal session receives a single-use login grant after the server is ready. Agent, CI, and non-interactive sessions receive `overmux auth login --port <resolved-port>` instead. The explicit flags override this environment-based default.

A grant prints one server-issued URL for every authenticated browser origin. Redeeming its code or any URL consumes the grant and authenticates only that origin; create another grant for another origin. The output identifies the browser login page, expiry, and command for creating another grant.

`--no-build` without `--production` is invalid. Vite's build output cleanup follows its `build.emptyOutDir` setting.

## Local instance discovery

The server stores its private control socket and registration in `$XDG_RUNTIME_DIR/overmux` when `XDG_RUNTIME_DIR` is absolute. If it is unset, empty, or relative, the directory is `/tmp/overmux-<uid>`, where `<uid>` is your numeric Unix user ID. If the preferred runtime directory exceeds 80 UTF-8 bytes, Overmux instead uses `/tmp/overmux-<uid>-<hash>`, with the first 12 hexadecimal SHA-256 characters of the preferred directory path. These fallbacks use literal `/tmp`, independently of `TMPDIR` and XDG state storage.

The directory must belong to the current user, must not itself be a symlink, and is secured with owner-only permissions (`0700`). The CLI uses the same location for discovery. After upgrading from a version that used state storage or another temporary directory, restart existing servers so the CLI can discover them; old locations are not searched.
