---
"@overmux/tmux": patch
---

Cancel pending xterm composition internally before local navigation, on observed pane/window/session changes, and on disconnect/failure, without remounting the textarea or adding application callbacks or ref methods. Unobserved native tmux changes remain outside this local cancellation guarantee.
