# @overmux/ghostty

A React 19 browser terminal backed by [`ghostty-web`](https://github.com/coder/ghostty-web). It owns Ghostty WASM initialization, rendering, fitting, font loading, and disposal. It does not provide a PTY or transport.

```tsx
import { useRef } from "react";
import {
  GhosttyTerminal,
  type GhosttyTerminalHandle,
} from "@overmux/ghostty/react";
import "@overmux/ghostty/styles.css";

const terminalRef = useRef<GhosttyTerminalHandle>(null);

<GhosttyTerminal
  onInput={(data) => connection.send(data)}
  onResize={({ cols, rows }) => connection.resize(cols, rows)}
  options={{
    cursorBlink: true,
    fontFamily: "JetBrains Mono",
    scrollback: 5_000,
    theme: { background: "#111827", foreground: "#f9fafb" },
  }}
  ref={terminalRef}
/>;
```

The public options and theme types are package-owned, deliberately covering the stable browser-rendering surface rather than re-exporting `ghostty-web` internals. The ref exposes `write`, `input`, `fit`, `focus`, and `reset`. Ghostty encodes accepted keyboard input itself; returning `false` from `onKeyEvent` rejects an event before Ghostty handles it. `onInputElementChange` reports Ghostty's textarea for shortcut managers; `onTitleChange` is forwarded from Ghostty when an OSC title update is received.

Each mounted terminal loads an isolated Ghostty WASM runtime. By default, `ghostty-web` resolves its packaged `ghostty-vt.wasm` using its own lookup paths. Pass `wasmUrl` to load a specific URL instead, for example when a content security policy requires application-hosted WASM:

```tsx
<GhosttyTerminal wasmUrl="/assets/ghostty-vt.wasm" />
```
