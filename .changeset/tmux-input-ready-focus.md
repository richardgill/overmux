---
"@overmux/tmux": patch
"@overmux/xterm": patch
"@overmux/zellij": patch
---

Focus active tmux terminals when their input element becomes ready, preserving focus on session changes. Rename the xterm input-element callback from `onInputChange` to `onInputElementChange` across terminal wrappers.
