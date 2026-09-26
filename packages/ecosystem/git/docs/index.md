---
title: Git (experimental)
---

> **Experimental:** compatibility is not guaranteed.

`@overmux/git` provides read-only Git status and selected-file diff resources for Overmux applications.

## Installation

```sh
cd ~/.config/overmux
pnpm add @overmux/git
```

## Server

Register status and diff resources under IDs chosen by your application. `allowedRoots` contains absolute directories that may contain repositories.

```ts
import { defineOvermuxServer } from "overmux";
import { gitDiffResource, gitStatusResource } from "@overmux/git/server";

export default defineOvermuxServer({
  resources: {
    gitStatus: gitStatusResource({ allowedRoots: ["/home/me/code"] }),
    gitDiff: gitDiffResource({ allowedRoots: ["/home/me/code"] }),
  },
});
```

`gitStatus` reads `{ repoRoot }` and returns the branch plus staged, unstaged, and conflicted file summaries. `repoRoot` must be an absolute repository root. A detached `HEAD` has `branch.name: null`; an unborn repository retains its intended branch name and reports `branch.unborn: true`.

`gitDiff` reads only one active file at a time:

```ts
{
  repoRoot: "/home/me/code/project",
  file: "src/app.ts",
  comparison: {
    base: { kind: "index" },
    target: "workingTree",
  },
}
```

Use `base: { kind: "commit", ref: "HEAD" }` with `target: "index"` for staged changes, or `target: "workingTree"` for a commit-to-working-tree comparison. The output contains full old/new text and structured hunks. Binary content has null text and no hunks.

Both resources are live subscriptions. They share repository watchers, but the server reads diffs only for files a client requests.

### Limits and unsupported diffs

Diff reads are limited to 16 MB per content side and Git commands time out after 30 seconds. The structured text-diff computation also has a short complexity limit, so applications should render resource errors rather than retrying them automatically. Binary files return no text or hunks. Conflicted files and submodules remain visible in status but their diffs are unsupported and return an error.

## React

`SourceControlView` is presentational: subscribe to status in application code and subscribe to a diff only for its selected file. Pass those independent values to the view.

```tsx
import { createOvermuxHooks, skipToken } from "overmux/client";
import { useState } from "react";
import {
  orderedChanges,
  SourceControlView,
  type GitChangeSelection,
} from "@overmux/git/react";

const { useResource } = createOvermuxHooks<typeof server>();

const GitPanel = ({ repoRoot }: { repoRoot: string }) => {
  const [selected, setSelected] = useState<GitChangeSelection>();
  const status = useResource({ id: "gitStatus", input: { repoRoot } });
  const changes = orderedChanges(status.data);
  const activeSelection =
    selected &&
    changes.some(
      (change) =>
        change.area === selected.area && change.path === selected.path,
    )
      ? selected
      : changes[0];
  const comparison =
    activeSelection?.area === "staged"
      ? {
          base: { kind: "commit" as const, ref: "HEAD" },
          target: "index" as const,
        }
      : activeSelection?.area === "unstaged"
        ? { base: { kind: "index" as const }, target: "workingTree" as const }
        : undefined;
  const diff = useResource({
    id: "gitDiff",
    input:
      activeSelection && comparison
        ? { repoRoot, file: activeSelection.path, comparison }
        : skipToken,
  });

  return (
    <SourceControlView
      diff={diff?.data}
      diffLoading={
        Boolean(activeSelection && comparison) && diff?.status === "pending"
      }
      error={status.error ?? diff?.error}
      loading={status.status === "pending"}
      onSelectChange={setSelected}
      selectedChange={activeSelection}
      status={status.data}
    />
  );
};
```

Import the component from `@overmux/git/react` and the package stylesheet from `@overmux/git/styles.css`. The package exposes no Git mutation operations.
