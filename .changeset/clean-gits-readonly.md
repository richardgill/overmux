---
"@overmux/git": patch
"overmux": patch
---

Replace legacy Git source-control resources and mutation operations with read-only status and selected-file diff resources. Preserve resource invalidations received during an active client read so subscribed views refresh after that read settles.
