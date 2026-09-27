---
title: Git (experimental)
---

> **Experimental:** compatibility is not guaranteed.

`@overmux/git` provides live, read-only Git data. It’s designed for building your own Git diff or PR review UI.

## Installation

```sh
cd ~/.config/overmux
pnpm add @overmux/git
```

## Resources

- `gitChanges` lists changed files, with optional diff hunks or full contents.
- `gitDiff` returns a single file’s complete contents and diff hunks.

Both update automatically when the repository changes.

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
