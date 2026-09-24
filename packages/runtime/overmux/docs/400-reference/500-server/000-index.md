---
title: Server
---

`overmux serve` runs Overmux's server on your dev machine.

Overmux's server architecture provides three primitives that package authors can take advantage of:

- [Resources](./100-resources.md): Expose server-side data to your UI. Read data on request, subscribe to changes, or derive values from other resources.
- [Operations](./200-operations.md): Expose server-side actions you can call from your UI or CLI.
- [Streams](./300-streams.md): Provide low-latency, bidirectional data flow between your UI and server, such as terminal input/output or live AI agent output.

See [Notifications](./400-notifications.md) for sending notifications and [Server API](./500-api.md) for definition helpers and handler context.
