---
"@overmux/tmux": patch
---

Discover terminal clients by their spawned PTY PID instead of a readiness handshake, preventing cancelled attachments from stranding the shared tmux command queue and stalling later navigation.
