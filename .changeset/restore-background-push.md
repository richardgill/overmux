---
"overmux": patch
---

Fix browser background notifications with a runtime-owned push service worker in development and production. Enable now registers an active worker with bounded failure reporting; notification clicks only navigate within the current origin.
