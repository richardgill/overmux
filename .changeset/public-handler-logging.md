---
"overmux": patch
---

Add structured `context.logger` logging to resource, stream, and operation handlers, with automatic capability and request/session correlation and safe cleanup logging.

Replace the top-level `debug` boolean with `logLevel: "debug" | "info" | "warn" | "error"`, defaulting to `"info"` in development and production. Runtime and handler events use the same severity threshold with no lifecycle exceptions; browser console forwarding is enabled only at `"debug"`. Remove `debug` from existing configuration and use `logLevel: "debug"` when investigating. The runtime protocol version increases to reject older browser manifests.
