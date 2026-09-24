---
title: xterm (terminal)
---

An [xterm.js](https://github.com/xtermjs/xterm.js) terminal for Overmux.

## Installation

```sh
cd ~/.config/overmux
pnpm add @overmux/xterm
```

## Basic usage

`<XtermTerminal>` is a React component that wraps xterm.js for Overmux UIs.

```tsx
import { useEffect, useRef } from "react";
import {
  XtermTerminal,
  type XtermTerminalHandle,
} from "@overmux/xterm/react";

export const TerminalView = () => {
  const terminalRef = useRef<XtermTerminalHandle>(null);

  useEffect(() => {
    terminalRef.current?.write("Hello from Overmux\r\n");
  }, []);

  return (
    <XtermTerminal
      ref={terminalRef}
      style={{ height: 400 }}
      onData={(data) => console.log("Input:", data)}
      onResize={(size) => console.log("Resize:", size)}
    />
  );
};
```

For a connected terminal with a persistent tmux backend, use [`@overmux/tmux/react`](/docs/packages/tmux#overmuxtmuxreact).

## Props

All props are optional.

| Prop | Purpose |
|---|---|
| `options` | Font, theme, cursor, and other xterm settings |
| `initOptions` | Creation-only settings |
| `ref` | Access terminal controls: write output, send input, focus, resize to fit, and reset. |
| `onData`, `onBinary` | Handle terminal input |
| `onResize` | Receive `{ cols, rows }` |
| `className`, `style` | Style the wrapper |
| `createAddons` | Add extra [xterm addons](https://xtermjs.org/docs/guides/using-addons/) |
| `keyMappings`, `onKeyEvent` | Customize keyboard handling |
| `transformInput` | Transform keyboard input, including phone keyboards and paste, before `onData` |
| `containerRef` | Access the wrapper element |
| `onInputChange` | Access the keyboard-input element; `null` on cleanup |

`initOptions` and addon setup apply only on mount.

## Terminal options

- `options`: [xterm.js settings](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/) that can change after creation, such as fonts, colors, and cursor style.
- `initOptions`: [xterm.js creation-only settings](https://xtermjs.org/docs/api/terminal/interfaces/iterminalinitonlyoptions/), such as initial `cols` and `rows`, plus Overmux's `unicodeActiveVersion` (`"6"` or `"11"`, default `"11"`). Remount to change these.

```tsx
<XtermTerminal
  initOptions={{ unicodeActiveVersion: "11" }}
  options={{
    cursorBlink: true,
    fontFamily: "JetBrains Mono",
    fontSize: 14,
    scrollback: 5_000,
    theme: { background: "#111827", foreground: "#f9fafb" },
  }}
/>
```

Updates to `options` merge with existing settings; omitted values aren’t reset.

## Differences from stock xterm.js

- Uses Unicode 11 instead of Unicode 6 for modern emoji widths.
- Enables `allowProposedApi` by default; set it to `false` to disable.
- Opens `http://`, `https://`, `file://`, and `overmux://` links without confirmation, subject to browser restrictions.
- Automatically fits the container, detects web links, and supports single-finger touch scrolling.

All other terminal options retain xterm.js defaults.

## Addons

Use `createAddons` to add [xterm.js addons](https://xtermjs.org/docs/guides/using-addons/). Install the addon in your Overmux configuration directory:

```sh
cd ~/.config/overmux
pnpm add @xterm/addon-search
```

```tsx
import { XtermTerminal } from "@overmux/xterm/react";
import { SearchAddon } from "@xterm/addon-search";

<XtermTerminal createAddons={() => [new SearchAddon()]} />
```

`createAddons` supplements the default addons. Create fresh instances each time it runs; they load after the terminal opens and are disposed with it. Addon setup applies only on mount; remount to change it.

### Overmux addons

These addons are included in `@overmux/xterm`; no additional installation is needed.

#### Web links

Enabled automatically. Detects plain-text HTTP(S) and Overmux URLs, including URLs wrapped across lines.

The terminal also supports [OSC 8 hyperlinks](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda): escape sequences that associate a visible label with a URL. Both detected URLs and OSC 8 hyperlinks use the same link handler.

By default, `http://`, `https://`, `file://`, and `overmux://` destinations open without confirmation. Invalid URLs and other schemes are ignored. Browser and operating-system restrictions still apply, particularly for `file://` links.

Customize link handling through `options.linkHandler`:

```tsx
<XtermTerminal
  options={{
    linkHandler: {
      activate: (_event, text) => {
        const url = URL.parse(text);
        if (url?.protocol === "https:") {
          window.open(url.href, "_blank", "noopener,noreferrer");
        }
      },
    },
  }}
/>
```

Link labels can disguise destinations; only activate links from output you trust.

[Source](https://github.com/richardgill/overmux/blob/main/packages/ecosystem/xterm/src/client/web-links.ts)

#### Clipboard access

Opt-in support for [OSC 52](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands): the terminal escape-sequence protocol that lets terminal programs request clipboard reads and writes.

Choose the minimum access your terminal programs need:

| Factory | Access | Blocked requests |
|---|---|---|
| `createWriteOnlyOsc52ClipboardAddon` | Write | Reads return empty |
| `createReadOnlyOsc52ClipboardAddon` | Read | Writes are ignored |
| `createReadAndWriteOsc52ClipboardAddon` | Read and write | Neither is blocked |

For copy-only support:

```tsx
import { createWriteOnlyOsc52ClipboardAddon } from "@overmux/xterm/client";

<XtermTerminal
  createAddons={() => [
    createWriteOnlyOsc52ClipboardAddon({ onError: console.error }),
  ]}
/>
```

For read-only access:

```tsx
import { createReadOnlyOsc52ClipboardAddon } from "@overmux/xterm/client";

<XtermTerminal createAddons={() => [createReadOnlyOsc52ClipboardAddon()]} />
```

For both:

```tsx
import { createReadAndWriteOsc52ClipboardAddon } from "@overmux/xterm/client";

<XtermTerminal
  createAddons={() => [createReadAndWriteOsc52ClipboardAddon()]}
/>
```

Reads can expose clipboard secrets to terminal programs. Writes can replace clipboard contents with untrusted text.

These factories use Overmux’s clipboard APIs by default. Supply `readText` or `writeText` callbacks to use your own implementation. Browser permissions and secure-context restrictions still apply.

The default `selection: "c"` targets the clipboard. Use `"p"` for the Linux-style primary selection, with custom callbacks. Other selections are ignored or answered empty.

##### Custom access policy

Use `createOsc52ClipboardAddon` to inspect the requested selection yourself. This example allows only writes to the clipboard:

```tsx
import { createOsc52ClipboardAddon } from "@overmux/xterm/client";
import { writeClipboardText } from "overmux/client";

<XtermTerminal
  createAddons={() => [
    createOsc52ClipboardAddon({
      readText: () => "",
      writeText: (selection, text) => {
        if (selection === "c") {
          return writeClipboardText(text);
        }
      },
      onError: console.error,
    }),
  ]}
/>
```

Callbacks may be asynchronous. Failures go to `onError` or the console; failed reads return empty.

#### GPU rendering

Opt-in WebGL rendering through `createSafeWebglAddon`. Falls back to xterm’s built-in renderer if initialization fails or the graphics context is lost.

```tsx
import { createSafeWebglAddon } from "@overmux/xterm/webgl";

<XtermTerminal
  createAddons={() => [
    createSafeWebglAddon({
      onDiagnostic: ({ status, message }) => console.log(status, message),
    }),
  ]}
/>
```

`onDiagnostic` reports `"active"` or `"fallback"`, with an optional message. The addon does not automatically retry after falling back.

Combine addons by returning them in the same array:

```tsx
import { createWriteOnlyOsc52ClipboardAddon } from "@overmux/xterm/client";
import { createSafeWebglAddon } from "@overmux/xterm/webgl";

<XtermTerminal
  createAddons={() => [
    createSafeWebglAddon(),
    createWriteOnlyOsc52ClipboardAddon(),
  ]}
/>
```

### Default addons

Included automatically:

- Xterm's built-in [FitAddon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit) sizes the terminal to its container.
- Xterm's built-in [Unicode11Addon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-unicode11) provides Unicode 11 character widths.
- [Overmux web-links addon](#web-links) detects clickable links.

[Clipboard access](#clipboard-access) and [GPU rendering](#gpu-rendering) are opt-in.

## Styling and DOM refs

Styles load automatically with `XtermTerminal`. Use `className` and `style` for the outer wrapper, and `options.theme` for terminal colors:

```tsx
<XtermTerminal
  className="my-terminal"
  style={{ height: 400 }}
  options={{ theme: { background: "#111", foreground: "#eee" } }}
/>
```

The stylesheet puts upstream xterm styles in the `om.components` CSS layer and scopes Overmux's wrapper rules. You can customize the wrapper background with `--om-xterm-terminal-background`.

`containerRef` exposes the outer wrapper DOM element, separately from the terminal handle. `onInputChange` receives xterm's keyboard-input element after opening, then `null` on cleanup, useful for shortcut-manager integration.

## Terminal controls

The React ref exposes `XtermTerminalHandle`, not the raw xterm instance:

```tsx
import { useRef } from "react";
import {
  XtermTerminal,
  type XtermTerminalHandle,
} from "@overmux/xterm/react";

export const TerminalControls = () => {
  const terminalRef = useRef<XtermTerminalHandle>(null);

  return (
    <>
      <XtermTerminal ref={terminalRef} style={{ height: 400 }} />
      <button onClick={() => terminalRef.current?.focus()}>Focus</button>
      <button onClick={() => terminalRef.current?.fit()}>Fit</button>
      <button onClick={() => terminalRef.current?.reset()}>Reset</button>
      <button onClick={() => terminalRef.current?.input("ls\r")}>Run ls</button>
      <button onClick={() => terminalRef.current?.write("Hello\r\n")}>
        Display output
      </button>
    </>
  );
};
```

`input(data, wasUserInput?)` injects input through the same event path as typing, so it reaches `onData`. `write(data, onProcessed?)` displays a string or `Uint8Array`; its optional callback runs after xterm processes the output, useful for controlling output flow.

## Keyboard mappings

Each `keyMappings` entry is `[shortcut, input]`: the left side identifies a keyboard shortcut, and the right side is the string sent as terminal input through `onData`, not displayed as output.

The input can be plain text or a terminal escape sequence that encodes a special key. In JavaScript strings, `\u001b` represents the Escape character and `\r` represents Enter. For example, `"\u001b[1;3D"` encodes Alt+Left Arrow; `"ls\r"` sends `ls` followed by Enter. See [xterm's key-sequence reference](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Special-Keyboard-Keys) for special keys:

```tsx
<XtermTerminal
  keyMappings={[
    ["Alt+ArrowLeft", "\u001b[1;3D"],
    ["Alt+ArrowRight", "\u001b[1;3C"],
  ]}
/>
```

Only `keydown` events are mapped. The first match prevents the browser default, sends the input string, and stops xterm's normal handling.

Use `onKeyEvent` to handle events not consumed by a mapping:

```tsx
<XtermTerminal
  onKeyEvent={(event) => {
    if (event.type === "keydown" && event.key === "Escape") {
      event.preventDefault();
      if (event.target instanceof HTMLElement) {
        event.target.blur();
      }
      return false;
    }
    return true;
  }}
/>
```

Returning `false` stops xterm handling; call `preventDefault()` separately when you also want to stop the browser default.

`onData` receives ordinary input. `onBinary` separately receives xterm's legacy binary input as a binary string. If your backend needs it, encode each character as a byte rather than encoding the string as UTF-8.

## Patched xterm behavior

Overmux uses [`@overmux/xterm-fork`](/docs/packages/xterm-fork), based on xterm.js 6.0.0, so wheel magnitude is preserved when terminal mouse tracking or alternate-scroll handling is active. A wheel gesture emits one mouse or arrow event per consumed wheel line instead of collapsing the gesture into one event. This is based on upstream [xterm.js PR #5803](https://github.com/xtermjs/xterm.js/pull/5803).

The patch also renders OSC 8 links with a solid underline instead of xterm's default dashed underline, and adds the input transformation for keyboard, text and paste used by the React wrapper.

These changes ship in the fork dependency automatically. Installing `@overmux/xterm` is sufficient; no pnpm patch or package-manager configuration is required.
