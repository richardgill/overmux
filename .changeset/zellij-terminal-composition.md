---
"@overmux/zellij": patch
---

Separate terminal connection ownership from rendering: call `useZellijTerminal({ stream })` and pass its result to `<ZellijXterm terminal={terminal} />`. Applications now own error and close UI. Renderer attachment supports bounded pending-output delivery without closing the connection, but does not reconstruct a destroyed screen. Default local xterm scrollback to zero with an explicit options override. Remove the extra Zellij wrapper, `containerClassName`, `containerStyle`, `ZellijXtermStyle`, and the `@overmux/zellij/styles.css` export; use xterm's `className` and `style` directly.
