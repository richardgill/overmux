---
title: Shortcuts
---

Shortcuts trigger [commands](./commands) from the keyboard. Define bindings on commands, then customize them in your client configuration.

## Adding shortcuts

Set `defaultBindings` on a command:

```tsx
const commands = defineCommandRegistry<typeof serverConfig>()({
  openSettings: {
    title: "Open settings",
    defaultBindings: ["Mod+,"],
  },
});
```

The command must have a registered, enabled handler. See [Registering a command](./commands#registering-a-command).

## Binding syntax

A binding combines optional modifiers with a key:

```tsx
defaultBindings: ["Mod+K"]
```

Use `Control`, `Alt`, `Shift`, or `Meta` for explicit modifiers. `Mod` means `Meta` (Command) on macOS and `Control` elsewhere.

Key names include uppercase letters, digits, `F1`–`F12`, and named keys such as `Enter`, `Escape`, `Space`, `Tab`, and `ArrowLeft`. Supported punctuation includes `/`, `[`, `]`, `\`, `=`, `-`, `,`, `.`, `;`, `:`, backtick, `'`, and `§`.

Modifiers use a fixed order: `Control+Alt+Shift+Meta`. With `Mod`, use `Mod+Alt+Shift`. Omit modifiers you do not need.

Use `Shift` with letters, function keys, or named keys, not digits or punctuation. For a colon, use `":"`, not `"Shift+;"`.

Multiple bindings provide alternative ways to trigger the same command:

```tsx
defaultBindings: ["Mod+K", "F2"]
```

Bindings match the key reported by the keyboard layout, not a physical key position. Holding a key does not repeatedly execute its command.

## Key sequences (chords)

Nest an array to require keys pressed in order:

```tsx
defaultBindings: [["F12", "X"]]
```

Press F12, then X to trigger the command. Each step can include modifiers:

```tsx
defaultBindings: [["Control+K", "Control+C"]]
```

Overmux waits up to one second between steps. Escape cancels the pending sequence. A nonmatching key ends it.

Avoid assigning a complete shortcut to another sequence’s prefix: the complete shortcut runs immediately rather than waiting for more keys.

## Overriding shortcuts

Use `shortcutOverrides` in your client configuration, keyed by command ID:

```tsx
export const client = defineOvermuxClient({
  commands,
  component: App,
  shortcutOverrides: {
    openSettings: ["Mod+Shift+O"],
  },
});
```

An override replaces all default bindings for that command. An empty array removes its keyboard shortcuts without disabling the command:

```tsx
shortcutOverrides: {
  openSettings: [],
}
```

## Conditional shortcuts

Wrap a binding with `when.media` to activate it only while a CSS media query matches:

```tsx
defaultBindings: [
  {
    binding: "Mod+,",
    when: { media: "(min-width: 800px)" },
  },
]
```

Conditional bindings work in both `defaultBindings` and `shortcutOverrides`, and update when the media query changes.

## Text inputs and terminals

Shortcuts do not run while an ordinary input, textarea, select, or editable text element has focus.

Terminals are an exception: modified keys, function keys, and multi-key sequences can trigger commands while typing. Plain single-key shortcuts are also allowed in terminal copy mode.

Matched shortcuts prevent the key’s normal browser or terminal behavior. Browser or operating-system shortcuts that never reach the page cannot be handled by Overmux.

### Replaying unmatched sequences

By default, keys intercepted for an incomplete sequence are discarded when it times out or fails to match.

Configure a prefix to replay those keys into a registered input instead. For example, suppose F12, then X closes a pane:

```tsx
const commands = defineCommandRegistry<typeof serverConfig>()({
  closePane: {
    title: "Close pane",
    defaultBindings: [["F12", "X"]],
  },
});
```

Enable replay for F12 in your client configuration:

```tsx
export const client = defineOvermuxClient({
  commands,
  component: App,
  chordPrefixes: [
    { binding: "F12", unmatched: "replay-to-focused-input" },
  ],
});
```

With the command’s handler registered and enabled, while a terminal has focus:

- **F12 → X:** closes the pane; neither key reaches the terminal.
- **F12 → Y:** no shortcut matches, so both F12 and Y are forwarded to the terminal.
- **F12 → wait one second:** F12 is forwarded to the terminal.
- **F12 → Escape:** cancels; neither key reaches the terminal.

This lets Overmux share a prefix with a terminal application rather than always swallowing it.

The tmux and Zellij terminal components already register replay targets. Custom terminal integrations can register one with:

```tsx
import { useShortcutInputTarget } from "overmux/client";

useShortcutInputTarget({
  container: containerRef,
  input: inputRef,
});
```

`container` identifies the focused UI region; `input` receives replayed keyboard events. If regions are nested, the innermost containing focus is selected when the sequence begins. Without a matching input target, intercepted keys cannot be replayed.

## Displaying bindings

Use `formatShortcutBinding` to format a binding for the current platform:

```tsx
import { formatShortcutBinding } from "overmux/client";

formatShortcutBinding("Mod+K");
formatShortcutBinding(["F12", "X"]);
```

On macOS, modifiers appear as symbols such as `⌘`; sequences display their steps separated by spaces.

Entries returned by [`useCommands()`](./commands#listing-all-registered-commands) expose their active, overridden bindings through `bindings`. Format those values to show shortcuts alongside command titles.
