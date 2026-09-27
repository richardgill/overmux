---
"@overmux/git": patch
"@overmux/pi": patch
"overmux": patch
---

Replace legacy Git source-control resources and mutation operations with read-only status and selected-file diff resources. Remove the Git React UI, including its views, navigation commands, stylesheet, and browser exports. Pi now owns the patch renderer it uses directly.

Preserve resource invalidations received during an active client read so subscribed views refresh after that read settles.
