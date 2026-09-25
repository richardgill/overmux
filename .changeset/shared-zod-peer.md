---
"overmux": patch
"@overmux/desktop": patch
"@overmux/git": patch
"@overmux/jsonl-store": patch
"@overmux/keybindings": patch
"@overmux/pi": patch
"@overmux/pty": patch
"@overmux/terminal-stream": patch
"@overmux/tmux": patch
"@overmux/ui": patch
"@overmux/xterm": patch
"@overmux/zellij": patch
---

Use Zod 4.6.5 throughout the workspace and rebuild dependent packages. Packages exposing Zod schemas now share the application's installation through a ^4.6.5 peer dependency so public schemas remain type-compatible. Newly initialized applications explicitly depend on Zod ^4.6.5.
