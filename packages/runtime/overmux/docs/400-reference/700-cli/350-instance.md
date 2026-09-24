---
title: "`overmux instance`"
---

Print the live server's `instanceId` and `deepLinkPrefix`. Like `overmux call`, this discovers a local running server through its private same-user control channel. It queries the identity resolved by that running server, never reloads local configuration, and does not verify HTTP or WebSocket reachability.

```sh
overmux instance
overmux instance --port 4242 --json
# {"instanceId":"rich-work-4242","deepLinkPrefix":"overmux://rich-work-4242"}

prefix=$(overmux instance --json | jq -r .deepLinkPrefix)
printf '%s/tmux/$71/@647/%%25647\n' "$prefix"
```

| Flag | Description |
| --- | --- |
| `--port <value>, -p <value>` | Select a running local server when several are available |
| `--json` | Print only a JSON object with `instanceId` and `deepLinkPrefix` |

The prefix has no trailing slash. Append your application route, encoding each path segment once: pane ID `%647` becomes `%25647`. An instance ID is a lookup key, not a hostname, network address, or credential. The desktop associates it with URLs learned from authenticated server connections.
