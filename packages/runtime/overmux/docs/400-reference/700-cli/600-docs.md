---
title: "`overmux docs`"
---

Overmux documentation and AI context commands

## `overmux docs path`

`overmux docs path` prints the installed Overmux CLI’s absolute documentation path.

```console
$ overmux docs path
/path/to/somewhere/node_modules/overmux/docs
```

## `overmux docs ai-context`

`overmux docs ai-context` prints `CLAUDE.md`/`AGENTS.md` guidance for coding agents.

### Usage

```text
overmux docs ai-context
```

Prints the selected snippets shown in [available snippets](#available-snippets).

### Set up your coding agent

Tell your agent how to load Overmux guidance using `overmux docs ai-context`.

<CodeBlockTabs defaultValue="agents">
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="agents">AGENTS.md</CodeBlockTabsTrigger>
    <CodeBlockTabsTrigger value="claude">CLAUDE.md</CodeBlockTabsTrigger>
  </CodeBlockTabsList>
  <CodeBlockTab value="agents">

```bash
echo 'Run `overmux docs ai-context` for help configuring Overmux.' >> AGENTS.md
```

  </CodeBlockTab>
  <CodeBlockTab value="claude">

```bash
echo 'Run `overmux docs ai-context` for help configuring Overmux.' >> CLAUDE.md
```

  </CodeBlockTab>
</CodeBlockTabs>

### Configure context snippets

Use `aiContextSnippets` in `overmux.config.ts` to select which snippets `overmux docs ai-context` prints.

```ts
import {
  coreAiContextSnippets,
  defineOvermuxConfig,
} from "overmux";

export default defineOvermuxConfig({
  aiContextSnippets: coreAiContextSnippets,
  // ...
});
```

When `aiContextSnippets` is omitted, Overmux uses `defaultAiContextSnippets`. Set it to an empty array to emit no context.

You can compose an explicit selection from the individual exports:

```ts
import {
  defineOvermuxConfig,
  packageSourceSnippet,
  techStackRecommendationsSnippet,
} from "overmux";

export default defineOvermuxConfig({
  aiContextSnippets: [
    packageSourceSnippet,
    techStackRecommendationsSnippet,
  ],
  // ...
});
```

### Options

| Flag | Description | Default |
| --- | --- | --- |
| `--config <path>, -c <path>` | Configuration file | `$XDG_CONFIG_HOME/overmux/overmux.config.ts` |

### Snippet presets

[//]: # (BEGIN GENERATED AI CONTEXT PRESETS)

| Export | Included snippets |
| --- | --- |
| `defaultAiContextSnippets` | `package-source`, `tech-stack-recommendations` |
| `coreAiContextSnippets` | `package-source` |

[//]: # (END GENERATED AI CONTEXT PRESETS)

### Available snippets

[//]: # (BEGIN GENERATED AI CONTEXT)

#### `package-source`

```text
Overmux ships with documentation and TypeScript source.

Run `overmux docs path` to find the installed documentation directory for the Overmux CLI. This prints a documentation directory, not source paths.

Inspect TypeScript source in installed packages, e.g. `node_modules/overmux/src` and `node_modules/@overmux/xterm/src`.

Inspect these files so guidance matches the versions used by the application.
```

#### `tech-stack-recommendations`

```text
Prefer pnpm as the package manager, TanStack Router for routing, shadcn/ui for UI components, and Zod for schemas and runtime validation. Follow the application's established stack when it already differs.
```

[//]: # (END GENERATED AI CONTEXT)
