---
title: Theming and CSS
---

Your Overmux UI owns its CSS. Overmux provides shared theme variables, light/dark defaults, and theme scopes for individual sections.

## Load your CSS

Import your stylesheet from your browser entry point:

```tsx
import { OvermuxHost } from "overmux/client";
import { createRoot } from "react-dom/client";

import definition from "./app";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <OvermuxHost definition={definition} />,
);
```

Overmux components load their own styles automatically. Use ordinary CSS and component `className` props to customize them. Overmux defaults use CSS layers, so normal unlayered application styles take precedence.

## Choose light or dark

Set appearance in your client definition:

```tsx
import { defineOvermuxClient } from "overmux/client";

export default defineOvermuxClient({
  commands: {},
  component: App,
  appearance: {
    scheme: "dark",
    contrast: "auto",
  },
});
```

- `scheme`: `"system"` (default), `"light"`, or `"dark"`.
- `contrast`: `"auto"` (default), `"normal"`, or `"high"`.

`"system"` follows the system color preference. `"auto"` follows the system preference for increased contrast.

Appearance applies to your app and Overmux-owned UI inside `OvermuxHost`. It changes built-in defaults, not custom CSS variables.

## Set colors, fonts, and other theme variables

Define shared variables in your stylesheet. This example supplies a custom dark palette and every shared theme variable:

```css
:root {
  --om-color-canvas: #111318;
  --om-color-surface: #191c24;
  --om-color-panel: #222735;
  --om-color-fg: #eef0f6;
  --om-color-muted: #a3adc2;
  --om-color-border: #394156;
  --om-color-accent: #b59aff;
  --om-color-accent-fg: #111318;
  --om-color-danger: #ff8b82;
  --om-color-success: #65d6a2;

  --om-font-sans: "Inter", sans-serif;
  --om-font-mono: "JetBrains Mono", monospace;

  --om-spacing: 0.75rem;
  --om-radius: 0.5rem;
  --om-elevation: 0 0.75rem 2rem rgb(0 0 0 / 30%);
  --om-focus-ring: 0 0 0 3px rgb(181 154 255 / 30%);
  --om-motion-duration: 120ms;
}
```

### Colors

- `--om-color-canvas`: page background.
- `--om-color-surface`: content surface background.
- `--om-color-panel`: panel and grouped-content background.
- `--om-color-fg`: primary text.
- `--om-color-muted`: secondary text.
- `--om-color-border`: borders and separators.
- `--om-color-accent`: highlighted controls and actions.
- `--om-color-accent-fg`: text on an accent background.
- `--om-color-danger`: errors and destructive states.
- `--om-color-success`: success states.

### Fonts

- `--om-font-sans`: interface font family.
- `--om-font-mono`: monospace font family.

Load custom fonts yourself; these variables only select them.

#### Loading custom fonts

Load fonts with `@font-face`, then reference their family names in your theme variables:

```css
@font-face {
  font-family: "My Font";
  src: url("./fonts/my-font.woff2") format("woff2");
  font-display: swap;
}

:root {
  --om-font-sans: "My Font", sans-serif;
}
```

For a monospace font, use the same approach with `--om-font-mono`.

### Spacing and effects

- `--om-spacing`: base spacing used by components.
- `--om-radius`: base corner radius.
- `--om-elevation`: elevated-surface box shadow.
- `--om-focus-ring`: additional focus box shadow.
- `--om-motion-duration`: transition duration.

Components decide which variables they use.

### Applying your theme

Variables on `:root` reach both your application and Overmux-owned UI, including recovery, update, and settings screens. The separate login screen does not load userland CSS.

Use the same variables in your own components:

```css
body {
  margin: 0;
  background: var(--om-color-canvas);
}

.panel {
  color: var(--om-color-fg);
  background: var(--om-color-surface);
  border: 1px solid var(--om-color-border);
  border-radius: var(--om-radius);
  padding: var(--om-spacing);
}
```

Overmux does not paint your application's page background for you.

Public `--om-*` variables are override inputs: Overmux does not populate them with its built-in palette. Define them before using them in your own CSS, or supply CSS fallbacks.

Custom values remain in effect when `scheme` changes. If you supply a custom palette, you also own its light/dark variants and any saved theme preference.

## Theme one section

Wrap a section in `OvermuxThemeScope`:

```tsx
import { OvermuxThemeScope } from "overmux/client";

<OvermuxThemeScope
  scheme="light"
  contrast="normal"
  className="preview"
  style={{ "--om-color-accent": "rebeccapurple" }}
>
  <Preview />
</OvermuxThemeScope>;
```

The scope renders a wrapper `<div>` and applies appearance to its contents.

Custom CSS variables inherit normally. A light scope inside a custom dark palette will still inherit those custom colors unless you override them.

`OvermuxHost` already creates an application-wide scope. A scope inside your app affects only that section, not surrounding Overmux-owned UI.

## Keep overlays themed

Use `OvermuxPortal` for menus, dialogs, and other overlays:

```tsx
import { OvermuxPortal, OvermuxThemeScope } from "overmux/client";

<OvermuxThemeScope scheme="dark">
  <Editor />
  <OvermuxPortal>
    <EditorMenu />
  </OvermuxPortal>
</OvermuxThemeScope>;
```

The overlay renders inside the nearest theme scope, preserving its appearance and inherited variables.

If you supply an external container, you own its theme attributes and CSS variables:

```tsx
<OvermuxPortal
  external={{
    container: overlayElement,
    scopeAttributesAndVariables: "caller-owned",
  }}
>
  <EditorMenu />
</OvermuxPortal>;
```

## Packages

Packages use shared `--om-*` variables where applicable. They may also expose additional CSS variables, `className`, `classNames`, or other styling props.

Some rendered content has separate theme options rather than inheriting CSS colors. See each package's documentation for its styling controls.
