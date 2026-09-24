---
title: xterm fork
---

`@overmux/xterm-fork` is Overmux's maintained xterm.js fork.

It keeps three source patches:

- **Input transformation:** a synchronous hook for encoded keys, committed text/IME (input method editor), and paste. Modify or suppress input, and use `cancelPendingInput()` to discard deferred composition without losing focus. Also fixes Android Gboard corrections replaying stale text, preserving trailing deletions before replacement text is inserted.
- **Wheel magnitude:** emits one mouse report or arrow sequence per consumed scroll line, rather than collapsing a gesture into one event.
- **OSC 8 hyperlinks:** solid underlines instead of dashed.

