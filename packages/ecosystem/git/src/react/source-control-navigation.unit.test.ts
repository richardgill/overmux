import { describe, expect, test as testCases } from "vitest";

import {
  navigateChange,
  orderedChanges,
  sourceControlCommands,
} from "./source-control-navigation";
import { gitChangeKey, type GitChange, type GitSourceControl } from "../shared";

const entries: GitChange[] = [
  {
    area: "staged",
    binary: false,
    deletions: 1,
    insertions: 1,
    path: "z.ts",
    status: "modified",
  },
  {
    area: "unstaged",
    binary: false,
    deletions: 1,
    insertions: 1,
    path: "a.ts",
    status: "modified",
  },
  {
    area: "unstaged",
    binary: false,
    deletions: 2,
    insertions: 2,
    path: "b.ts",
    status: "modified",
  },
];
const sourceControl: GitSourceControl = {
  branch: { ahead: 0, behind: 0, name: "main" },
  changes: entries as Extract<
    GitSourceControl,
    { comparison: "uncommitted" }
  >["changes"],
  comparison: "uncommitted",
  diffs: Object.fromEntries(
    entries.map((change) => [
      gitChangeKey(change),
      {
        binary: false,
        newContent: "new\n",
        oldContent: "old\n",
        patch: "@@ -1 +1 @@\n-old\n+new",
        path: change.path,
      },
    ]),
  ),
  revision: "revision",
  root: "/repo",
};

describe("source control navigation", () => {
  testCases("publishes file and half-screen commands without bindings", () => {
    expect(Object.keys(sourceControlCommands)).toEqual([
      "sourceControl.nextFile",
      "sourceControl.previousFile",
      "sourceControl.scrollDown",
      "sourceControl.scrollUp",
    ]);
    expect(
      Object.values(sourceControlCommands).every(
        (command) => command.defaultBindings === undefined,
      ),
    ).toBe(true);
  });

  testCases("orders by area and tree path and wraps files", () => {
    expect(orderedChanges(sourceControl).map(gitChangeKey)).toEqual([
      "unstaged:a.ts",
      "unstaged:b.ts",
      "staged:z.ts",
    ]);
    expect(
      navigateChange({
        direction: 1,
        selectedChange: entries[0],
        sourceControl,
      }),
    ).toEqual(entries[1]);
    expect(
      navigateChange({
        direction: -1,
        selectedChange: entries[1],
        sourceControl,
      }),
    ).toEqual(entries[0]);
  });

  testCases("matches the tree's directory-first natural path order", () => {
    const paths = [
      "z.ts",
      "src/z.ts",
      "a.ts",
      "src/a.ts",
      "file10.ts",
      "file2.ts",
    ];
    const unordered: GitSourceControl = {
      ...sourceControl,
      changes: paths.map((path) => ({
        area: "unstaged",
        binary: false,
        deletions: 0,
        insertions: 0,
        path,
        status: "modified",
      })),
    };
    expect(orderedChanges(unordered).map(({ path }) => path)).toEqual([
      "src/a.ts",
      "src/z.ts",
      "a.ts",
      "file2.ts",
      "file10.ts",
      "z.ts",
    ]);
  });

  testCases("sorts area-less base changes", () => {
    const base: GitSourceControl = {
      base: "base",
      changes: [
        {
          binary: false,
          deletions: 0,
          insertions: 1,
          path: "z.ts",
          status: "added",
        },
        {
          binary: false,
          deletions: 1,
          insertions: 0,
          path: "a.ts",
          status: "deleted",
        },
      ],
      comparison: "base",
      diffs: {},
      revision: "revision",
      root: "/repo",
    };
    expect(orderedChanges(base).map(({ path }) => path)).toEqual([
      "a.ts",
      "z.ts",
    ]);
  });
});
