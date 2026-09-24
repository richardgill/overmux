---
"@overmux/xterm-fork": patch
---

Handle Android non-composition text edits through input events only, preventing Gboard corrections from replaying stale textarea contents. Translate observed trailing deletions into terminal backspaces before inserting the correction.
