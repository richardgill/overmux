---
title: Storage Locations
---

Overmux follows [XDG base directory conventions](https://specifications.freedesktop.org/basedir-spec/latest/).

## Configuration

`$XDG_CONFIG_HOME/overmux`, default `~/.config/overmux`.

- `overmux.config.ts`: application configuration. Override with `--config /another/overmux.config.ts`.
- `overmux.desktop.ts`: optional Overmux Desktop settings. Override with `--desktop-config /another/overmux.desktop.ts`.
- Your Overmux project, created by `overmux init`. See [project structure](./100-project-structure.md).

## Data

`$XDG_DATA_HOME/overmux`, default `~/.local/share/overmux`.

- `auth/auth.json`: persisted authentication state.
- `auth/auth.lock`: authentication store lock.
- `background-notifications/vapid.json`: push notification keys, including the private key.
- `background-notifications/subscriptions.json`: push notification subscriptions.

## State

`$XDG_STATE_HOME/overmux`, default `~/.local/state/overmux`.

- `overmux.log`: server logs.
- `desktop/`: desktop profile, including saved server addresses, browser sessions, and Chromium caches. Can contain credentials; not disposable cache.

## Cache

`$XDG_CACHE_HOME/overmux`, default `~/.cache/overmux`.

Cache files; currently unused.

## Runtime

`$XDG_RUNTIME_DIR/overmux`, default `/tmp/overmux-<uid>`.

- `<id>.sock`: per-instance control socket for local CLI requests.
- `<id>.json`: instance registration, including its process ID, URLs, port, and control socket path.

Overmux uses `/tmp/overmux-<uid>` when `XDG_RUNTIME_DIR` is unset. If the runtime directory path exceeds 80 bytes, Overmux uses `/tmp/overmux-<uid>-<hash>` to stay within socket path limits.

`<uid>` is your numeric user ID. `<hash>` is derived from the original runtime directory path.
