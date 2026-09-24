---
title: "`overmux auth`"
---

Manage browser login grants and sessions for a running local Overmux server.

Authentication administration uses the private same-user control socket. When multiple local servers are running, use `--port` to select one.

## Create a login grant

```text
overmux auth login [--code] [--json] [--port value] [--url]
```

| Flag | Description |
| --- | --- |
| `--code` | Print only the login code |
| `--json` | Print machine-readable JSON |
| `--port <value>` | Running local server port |
| `--url` | Print only the primary origin's login URL |

Set at most one of `--code`, `--url`, and `--json`. Default output prints the code, every server-issued URL in order, the exact expiry, and the command for creating another grant. `--url` prints only the primary origin's URL, `--code` prints only the code, and JSON output contains the grant metadata with its ordered `urls` array. Every URL embeds the same secret ticket; the code and ticket belong to one single-use grant. Redeeming any one of them consumes the whole grant and authenticates only that origin, so create another grant to log in at another origin.

## List sessions

```text
overmux auth list [--json] [--port value]
```

| Flag | Description |
| --- | --- |
| `--json` | Print machine-readable JSON |
| `--port <value>` | Running local server port |

Session output contains non-secret metadata only, including the browser origin that issued each session. Non-expiring sessions report their expiry as `never`.

## Revoke sessions

```text
overmux auth revoke [--all] [--json] [--port value] [<id>]
```

| Flag | Description |
| --- | --- |
| `--all` | Revoke every active session |
| `--json` | Print machine-readable JSON |
| `--port <value>` | Running local server port |

Specify exactly one session ID or `--all`. Revocation immediately invalidates the selected browser sessions.
