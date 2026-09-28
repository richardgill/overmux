---
title: Git (experimental)
---

> **Experimental:** compatibility is not guaranteed.

`@overmux/git` provides live Git status and diffs, plus optional operations for staging, unstaging, and discarding changes. Use it to build your own Git diff or review UI.

## Installation

```sh
cd ~/.config/overmux
pnpm add @overmux/git
```

## Resources and operations

**Resources** provide read-only data and update automatically when the repository changes:

- `gitChanges` lists changed files, with optional diff hunks or full contents.
- `gitDiff` returns one file’s complete contents and diff hunks.

**Operations** modify the repository:

- `stage` stages selected files.
- `unstage` unstages selected files without changing their working copies.
- `discard` discards unstaged edits or permanently deletes selected untracked files.
- `applyIndexPatch` applies a patch to staging, or reverses one to unstage selected edits.

## Operations

### Register operations

Add `gitOperationHandlers` to your server configuration:

```ts title="overmux.config.ts"
import { defineOvermuxConfig } from "overmux";
import { gitOperationHandlers } from "@overmux/git/server";

export default defineOvermuxConfig({
  // ...your existing configuration
  server: {
    operations: {
      ...gitOperationHandlers({
        allowedRoots: ["/home/me/code"],
        permissions: {
          stage: true,
          unstage: true,
          discard: true,
          applyIndexPatch: true,
        },
      }),
    },
  },
});
```

`allowedRoots` restricts operations to repositories within those directories on the server machine. Permissions default to `false`; you can enable only the operations your Overmux needs.

### Stage files

Stage selected files, including new files and deletions. 

Import `useOperation` from your Overmux’s [typed hooks module](/docs/reference/client/api#createovermuxhooks):

```ts
import { useOperation } from "./overmux";

// Inside your component:
const stage = useOperation({ id: "stage" });

// Inside your event handler:
await stage.mutateAsync({
  repoRoot: "/home/me/code/app",
  files: ["src/app.ts"],
});
```

`repoRoot` is the absolute repository path on the server machine. `files` contains repository-relative paths.

### Unstage files

Unstage selected files without changing their working copies or unrelated staged changes.

```ts
import { useOperation } from "./overmux";

// Inside your component:
const unstage = useOperation({ id: "unstage" });

// Inside your event handler:
await unstage.mutateAsync({
  repoRoot: "/home/me/code/app",
  files: ["src/app.ts"],
});
```

### Discard changes

Discard unstaged edits to selected files. Tracked files are restored from the index (staging area), preserving staged changes.

**Untracked files and directories are permanently deleted.** Ignored and unselected files are retained. Ask for confirmation in your Overmux before calling this operation.

Conflicted, unchanged, staged-only, and ignored-only selections are rejected before any changes are made. For tracked files, select individual files rather than directories.

```ts
import { useOperation } from "./overmux";

// Inside your component:
const discard = useOperation({ id: "discard" });

// Inside your event handler, after confirmation:
await discard.mutateAsync({
  repoRoot: "/home/me/code/app",
  files: ["src/app.ts", "scratch-output"],
});
```

### Apply a patch to staging

Use `createGitPatch` to convert a [`gitDiff`](#gitdiff) result into a patch, then apply it to staging. Working files are unchanged.

Here, `diff` is a successful `gitDiff` subscription:

```ts
import { createGitPatch } from "@overmux/git/shared";
import { useOperation } from "./overmux";

// Inside your component:
const applyIndexPatch = useOperation({ id: "applyIndexPatch" });

// Inside your event handler:
const patch = createGitPatch({ diff: diff.data });

await applyIndexPatch.mutateAsync({
  repoRoot: "/home/me/code/app",
  patch,
});
```

Use an **index → working tree** comparison for staging. To unstage, use **HEAD → index** and pass `reverse: true`:

```ts
await applyIndexPatch.mutateAsync({
  repoRoot: "/home/me/code/app",
  patch,
  reverse: true,
});
```

#### Create a patch

`createGitPatch` includes every hunk by default. To include only some hunks, pass them explicitly:

```ts
const patch = createGitPatch({
  diff: diff.data,
  hunks: selectedHunks,
});
```

The helper creates text patches without modifying the repository. Use `stage` or `unstage` for binary files and changes without text hunks.

## Resources

- `gitChanges` lists changed files, with optional diff hunks or full contents.
- `gitDiff` returns a single file’s complete contents and diff hunks.

Both update automatically when the repository changes.

### Watching and freshness

A subscription watches **directories**, not just files already listed by Git. Existing empty directories, new nested directories, and populated trees moved into the repository remain discoverable. Watches are shared across resources, comparisons, and clients for the same canonical repository root; authorization and results are not shared.

Git decides which directories are ignored, using its own nested `.gitignore` rules, `.git/info/exclude`, and effective global excludes/configuration. Ignored-only trees such as `node_modules` are skipped **before descent**, not merely filtered after notifications. There is no hard-coded dependency-directory blacklist. Git's rules have two important consequences:

- Ignoring a directory does not untrack files already in the index (the staging area). Their ancestor directories remain watched, including force-added files under ignored directories. Adding/removing index entries recomputes coverage.
- A `!` rule can re-include a path only if Git permits reaching it through its parent directories. Rule order and the location of each `.gitignore` matter; a generic glob matcher is not equivalent to Git.

Native events normally request a refresh after a bounded 75 ms coalescing window. Directory/rule/metadata changes also schedule a single coverage rebuild after 250 ms. These are scheduling delays, not end-to-end latency guarantees: Git reads, filesystem work, and server load take additional time. A refresh after watch installation covers changes made during setup. Directory watches survive atomic file replacement, and ordinary worktree lockfiles such as `Cargo.lock` are not suppressed.

**Reconciliation** means checking actual current state again rather than trusting that every filesystem event arrived. While at least one subscription exists, one shared timer rebuilds scope and requests a full resource refresh 30 seconds after the previous scope scan finishes. This catches lost events, new global excludes/config includes, and edits whose Git status stays unchanged (for example, editing an already-modified file again). External configuration files are deliberately not individually watched: their effects can take this reconciliation interval plus scan/read time to appear. Native watch errors log a warning, retain successful watches, and retry during reconciliation rather than leaving permanently stale subscriptions. Persistent Git/read errors remain errors, not a freshness guarantee.

Overmux's `useResource` keeps one read per query in flight and retains one follow-up invalidation when changes arrive during that read. Opening/reconnecting subscriptions refreshes them; `refetch()` requests an immediate read. There is no new focus hook. Unsubscribe or use `skipToken` for an inactive view: mounted subscriptions, including hidden preloads, still incur reconciliation. The final unsubscribe aborts scope discovery, releases native handles, and cancels timers. Unsubscribed repositories incur no watcher or reconciliation work.

#### Boundaries and cost

- Per-worktree index/HEAD and shared refs/packed-refs/config/info directories are watched, including linked worktrees. Objects, logs, hooks, and other worktrees' administrative trees are not crawled. Unborn repositories (no first commit) need no special watcher mode. Nonstandard metadata such as reftable storage relies on reconciliation.
- Directory symlinks are not followed, even back into the repository; a symlink itself can still change. The existing canonical-root authorization and file-read symlink restrictions remain in force. As with ordinary filesystem reads, this is not a sandbox against a malicious process concurrently replacing directory ancestors.
- Submodules are separate repositories: their directories are not recursively watched by the parent. Parent results reconcile periodically; subscribe to the submodule root for its live file diffs. Submodule/directory diffs remain unsupported by `gitDiff`.
- NUL-delimited Git plumbing preserves spaces, tabs, and newlines in names. The string-based API requires UTF-8 paths; undecodable tracked/directory names warn and fall back to reconciliation, rather than silently watching a different decoded path.
- Native notifications are not an audit log. Watch limits, permissions, queue overflow, network filesystems, and short-lived changes can lose events. Reconciliation repairs current state once reads succeed; it cannot recover every intermediate transition. Very large eligible trees still cost traversal, handles, and periodic I/O. Traversal uses bounded directory batches and yields between batches; it does not make all repositories cheap.

The private scope builder uses batched Git ignore checks and a tracked-ancestor set; shallow Node directory watches avoid recursive traversal by the watcher backend. The backend is a latency accelerator over reconciliation, not the authority for Git state. This separates scope decisions from notification delivery without introducing a native dependency or a new public configuration surface.

### `gitChanges`

Register `gitChanges` inline in your existing Overmux configuration:

```ts title="overmux.config.ts"
import { defineOvermuxConfig } from "overmux";
import { gitChangesResource } from "@overmux/git/server";

export default defineOvermuxConfig({
  ...
  server: {
    resources: {
      gitChanges: gitChangesResource(),
    },
  },
});
```

By default, `gitChangesResource` allows access to any repository the server process can read. Use `allowedRoots` to restrict access to repositories within specific directories:

```ts
gitChangesResource({
  allowedRoots: ["/home/me/code"],
});
```

#### Subscribe to git changes

Import `useResource` from your Overmux's [typed Overmux hooks module](/docs/reference/client/api#createovermuxhooks), then subscribe inside your React component:

```ts
import { useResource } from "./overmux";

const changes = useResource({
  id: "gitChanges",
  input: {
    repoRoot: "/home/me/code/app",
    comparisons: {
      uncommitted123: {
        base: { kind: "commit", ref: "HEAD" },
        target: { kind: "workingTree" },
      },
    },
  },
});
```

`changes.data` contains:

```jsonc

{
  "repoRoot": "/home/me/code/app",
  "comparisons": {
    "uncommitted123": [
      {
        "path": "src/file.ts",

        "status": "modified", // added | modified | deleted | renamed | untracked | conflicted

        "binary": false, // Binary files return no text contents or hunks.

        "lineStats": { "added": 1, "deleted": 1 }, // null for binary or unsupported content.

        // Ready-to-use params for the gitDiff resource (see below).
        "diffParams": {
          "repoRoot": "/home/me/code/app",
          "file": "src/file.ts",
          "comparison": {
            "base": { "kind": "commit", "ref": "HEAD" },
            "target": { "kind": "workingTree" }
          },
          "contextLines": 3
        }
      }
    ]
  }
}
```

Results are grouped by your comparison names and update automatically as the repository changes. Branch metadata is omitted here for brevity.

#### Parameters

##### `repoRoot`

The absolute repository path on the machine running your Overmux server. Use the repository root, not a directory inside it.

##### `detailLevel`

Choose how much data to return for each changed file. These examples show one entry in `changes.data?.comparisons.uncommitted` after changing a greeting from `"hello"` to `"hi"`.

###### `"summary"` (default)

Returns file information, line counts and `diffParams`, without a `diff` property:

```jsonc
{
  "path": "src/file.ts",
  "status": "modified",
  "binary": false,
  "lineStats": { "added": 1, "deleted": 1 },
  "diffParams": {
    // ...
  }
}
```


###### `"hunks"`

Contains everything in `"summary"`, plus `diff.hunks`: changed lines and surrounding unchanged code, with line numbers. Complete file contents are omitted:

```jsonc
{
  "path": "src/file.ts",
  "status": "modified",
  "binary": false,
  "lineStats": { "added": 1, "deleted": 1 },
  "diffParams": {
    // ...
  },
  "diff": {
    "hunks": [
      {
        "oldStart": 1,
        "oldCount": 3,
        "newStart": 1,
        "newCount": 3,
        "lines": [
          { "kind": "context", "oldLine": 1, "newLine": 1, "text": "export const greeting = () => {" },
          { "kind": "removed", "oldLine": 2, "text": "  return \"hello\";" },
          { "kind": "added", "newLine": 2, "text": "  return \"hi\";" },
          { "kind": "context", "oldLine": 3, "newLine": 3, "text": "};" }
        ]
      }
    ]
  }
}
```

###### `"full"`

Contains everything in `"hunks"`, plus `diff.oldContent` and `diff.newContent`: both complete file versions, preserving their line endings:

```jsonc
{
  "path": "src/file.ts",
  "status": "modified",
  "binary": false,
  "lineStats": { "added": 1, "deleted": 1 },
  "diffParams": {
    // ...
  },
  "diff": {
    "hunks": [
      {
        "oldStart": 1,
        "oldCount": 3,
        "newStart": 1,
        "newCount": 3,
        "lines": [
          { "kind": "context", "oldLine": 1, "newLine": 1, "text": "export const greeting = () => {" },
          { "kind": "removed", "oldLine": 2, "text": "  return \"hello\";" },
          { "kind": "added", "newLine": 2, "text": "  return \"hi\";" },
          { "kind": "context", "oldLine": 3, "newLine": 3, "text": "};" }
        ]
      }
    ],
    "oldContent": "export const greeting = () => {\n  return \"hello\";\n};\n",
    "newContent": "export const greeting = () => {\n  return \"hi\";\n};\n"
  }
}
```

##### `contextLines`

Applies to `detailLevel: "hunks"` and `detailLevel: "full"`. Controls the number of unchanged lines included around each change in a hunk. Defaults to `3`; use `0` for changed lines only.

For example, the greeting change above would render like this with `contextLines: 3`:

```diff
 export const greeting = () => {
-  return "hello";
+  return "hi";
 };
```

With `contextLines: 0`, only the changed lines are included:

```diff
-  return "hello";
+  return "hi";
```

These examples illustrate the structured hunk data; the resource does not return raw patch strings. Context is limited by the start and end of the file, so there may be fewer than three surrounding lines.

This affects hunks, not the complete file contents returned by `"full"`.

##### `comparisons`

Request one or more named comparisons. The names are yours to choose; they become keys in the response.

For example, this `comparisons` value requests two comparisons:

```json
{
  "readyToCommit": {
    "base": { "kind": "commit", "ref": "HEAD" },
    "target": { "kind": "index" }
  },
  "notYetStaged": {
    "base": { "kind": "index" },
    "target": { "kind": "workingTree" }
  }
}
```

Their results are available at:

```ts
changes.data?.comparisons.readyToCommit
changes.data?.comparisons.notYetStaged
```

`readyToCommit` and `notYetStaged` are labels, not predefined modes. Renaming a key changes the response key.

Each comparison has two parameters:

- **`base`**: the version to compare from.
- **`target`**: the version to compare to.

Added and deleted lines are measured from `base` → `target`.

Both use a `kind` to identify the source:

| `kind` | Additional parameters | Meaning | Allowed as |
|---|---|---|---|
| `"commit"` | `ref` | A commit identified by a branch, tag, commit hash or expression such as `HEAD~1` | Base or target |
| `"index"` | None | The staged version | Base or target |
| `"workingTree"` | None | Current files on disk | Target |
| `"mergeBase"` | `refs` | The common ancestor of two explicitly named refs | Base |

When the base is `"index"`, the target must be `"workingTree"`.

For example, a merge-base source looks like:

```json
{
  "kind": "mergeBase",
  "refs": ["origin/main", "HEAD"]
}
```

Each JSON example below is the value of `comparisons`. The Git commands show equivalent tracked-file comparisons. Working-tree resource comparisons also include untracked files that aren’t ignored.

###### Unstaged changes

Compare the index (staging area) with your current working files.

```sh
git diff
```

```json
{
  "unstaged": {
    "base": { "kind": "index" },
    "target": { "kind": "workingTree" }
  }
}
```

###### Staged changes

Compare the current commit with the index.

```sh
git diff --cached
```

```json
{
  "staged": {
    "base": { "kind": "commit", "ref": "HEAD" },
    "target": { "kind": "index" }
  }
}
```

###### All uncommitted changes

Compare the current commit with your working files, combining staged and unstaged edits.

```sh
git diff HEAD
```

```json
{
  "uncommitted": {
    "base": { "kind": "commit", "ref": "HEAD" },
    "target": { "kind": "workingTree" }
  }
}
```

###### Working files against a remote branch

Compare the locally fetched `origin/main` commit with your working files. The resource does not fetch automatically.

```sh
git diff origin/main
```

```json
{
  "againstMain": {
    "base": { "kind": "commit", "ref": "origin/main" },
    "target": { "kind": "workingTree" }
  }
}
```

###### Compare two commits or branches

Compare committed versions without including staged or unstaged edits. Refs can name branches, tags or commit hashes.

```sh
git diff origin/main HEAD
```

```json
{
  "committed": {
    "base": { "kind": "commit", "ref": "origin/main" },
    "target": { "kind": "commit", "ref": "HEAD" }
  }
}
```

###### Committed changes since branching

Compare the common ancestor of `origin/main` and `HEAD` with your current commit. This is useful for reviewing the committed changes on your branch.

```sh
git diff origin/main...HEAD
```

```json
{
  "committedSinceBranching": {
    "base": {
      "kind": "mergeBase",
      "refs": ["origin/main", "HEAD"]
    },
    "target": { "kind": "commit", "ref": "HEAD" }
  }
}
```

###### All changes since branching

Compare the same common ancestor with your working files, including uncommitted edits.

```sh
git diff "$(git merge-base origin/main HEAD)"
```

```json
{
  "sinceBranching": {
    "base": {
      "kind": "mergeBase",
      "refs": ["origin/main", "HEAD"]
    },
    "target": { "kind": "workingTree" }
  }
}
```

### `gitDiff`

Returns the complete old/new contents and diff hunks for one file.

Register `gitDiff` inline in your existing Overmux configuration:

```ts title="overmux.config.ts"
import { defineOvermuxConfig } from "overmux";
import { gitDiffResource } from "@overmux/git/server";

export default defineOvermuxConfig({
  ...
  server: {
    resources: {
      gitDiff: gitDiffResource(),
    },
  },
});
```

The optional `allowedRoots` setting works the same as for `gitChangesResource`.

#### Subscribe to a file’s diff

Each file returned by `gitChanges` includes `diffParams`, ready to pass into `gitDiff`.

For example, subscribe to the first file in the `uncommitted` group from the example above:

```ts
import { skipToken } from "overmux/client";
import { useResource } from "./overmux";

const selectedChange = changes.data?.comparisons.uncommitted[0];

const diff = useResource({
  id: "gitDiff",
  input: selectedChange?.diffParams ?? skipToken,
});
```

`skipToken` skips the subscription when there is no selected file. The result is available at `diff?.data` and updates automatically when the repository changes.

For example, `diff?.data` contains:

```json
{
  "file": "src/file.ts",
  "binary": false,
  "oldContent": "export const greeting = () => {\n  return \"hello\";\n};\n",
  "newContent": "export const greeting = () => {\n  return \"hi\";\n};\n",
  "hunks": [
    {
      "oldStart": 1,
      "oldCount": 3,
      "newStart": 1,
      "newCount": 3,
      "lines": [
        { "kind": "context", "oldLine": 1, "newLine": 1, "text": "export const greeting = () => {" },
        { "kind": "removed", "oldLine": 2, "text": "  return \"hello\";" },
        { "kind": "added", "newLine": 2, "text": "  return \"hi\";" },
        { "kind": "context", "oldLine": 3, "newLine": 3, "text": "};" }
      ]
    }
  ]
}
```

A missing file version is `null`; an empty text file is `""`. Binary files return `binary: true`, null contents and no hunks. Renamed files also include `previousPath`.

#### Parameters

You can pass the `diffParams` returned by the `gitChanges` resource. You can also provide these parameters directly.

##### `repoRoot`

The absolute repository root on the machine running your Overmux server.

##### `file`

The repository-relative file path, such as `src/file.ts`. For a renamed file, use its new path.

##### `comparison`

One base/target comparison, using the same source kinds as [`gitChanges.comparisons`](#comparisons). Unlike `comparisons`, this is a single comparison without a group name:

```json
{
  "base": { "kind": "commit", "ref": "HEAD" },
  "target": { "kind": "workingTree" }
}
```

For `src/file.ts`, this is equivalent to:

```sh
git diff HEAD -- src/file.ts
```

##### `contextLines`

The number of unchanged lines around each change in a hunk. Defaults to `3`; use `0` for changed lines only.

This does not affect the complete `oldContent` and `newContent`.
