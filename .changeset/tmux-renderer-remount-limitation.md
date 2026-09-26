---
"@overmux/tmux": patch
---

Document that renderer remount redraws do not restore all xterm state, including mouse, paste, and application-key modes. Recommend keeping the renderer mounted while hiding views, and clarify the distinction between connection cleanup and emulator-state preservation.
