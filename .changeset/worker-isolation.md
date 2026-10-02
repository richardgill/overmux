---
"overmux": patch
---

Isolate each named stream from the shared resource/operation worker. Query, subscription, and derived resources continue to run together with operations; each named stream has its own worker.

Remove `context.invalidate` from stream handlers. Resource and operation contexts retain invalidation. Use an operation to mutate data and invalidate resources, or a subscription resource watcher to refresh clients when an external source changes.
