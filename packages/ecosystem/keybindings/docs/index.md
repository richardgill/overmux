---
title: Keybindings
---

# Keybindings

`@overmux/keybindings` provides shared keybinding contracts and matching utilities.

## Installation

```sh
cd ~/.config/overmux
pnpm add @overmux/keybindings
```

## Usage

```ts
import { matchesKeyBinding, type KeyBinding } from "@overmux/keybindings";

const binding: KeyBinding = "Control+Shift+C";

window.addEventListener("keydown", (event) => {
  if (matchesKeyBinding(binding, event)) {
    event.preventDefault();
    copyTerminalSelection();
  }
});
```

`keyBindingSchema` validates bindings at runtime. `formatKeyBinding` renders them for the current platform, and `platformBinding` resolves `Mod` to `Meta` on Apple platforms or `Control` elsewhere.
