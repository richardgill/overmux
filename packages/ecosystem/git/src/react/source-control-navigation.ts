// Orders caller-named comparison groups and preserves group/path selection identity.
import { prepareFileTreeInput } from "@pierre/trees";
import { defineCommandRegistry } from "overmux/client";

import type { GitFileChange, GitChanges } from "../shared";

type Direction = 1 | -1;

export type GitChangeSelection = { group: string; path: string };
export type SelectedGitChange = GitFileChange & { group: string };

export const sourceControlCommands = defineCommandRegistry<unknown>()({
  "sourceControl.nextFile": { title: "Next changed file" },
  "sourceControl.previousFile": { title: "Previous changed file" },
  "sourceControl.scrollDown": { title: "Scroll diff down half a screen" },
  "sourceControl.scrollUp": { title: "Scroll diff up half a screen" },
});
export type SourceControlCommandHandles = typeof sourceControlCommands;

const sortPaths = <T extends { path: string }>(changes: readonly T[]) => {
  const byPath = new Map(changes.map((change) => [change.path, change]));
  return prepareFileTreeInput(changes.map(({ path }) => path)).paths.flatMap(
    (path) => byPath.get(path) ?? [],
  );
};

export const orderedChanges = (status?: GitChanges): SelectedGitChange[] =>
  Object.entries(status?.changes ?? {}).flatMap(([group, changes]) =>
    sortPaths(changes).map((change) => ({ ...change, group })),
  );

export const sameChange = (
  change: GitChangeSelection,
  selection?: GitChangeSelection,
) => change.group === selection?.group && change.path === selection?.path;

const cycleIndex = (index: number, length: number, direction: Direction) =>
  (index + direction + length) % length;

export const navigateChange = ({
  direction,
  selectedChange,
  status,
}: {
  direction: Direction;
  selectedChange?: GitChangeSelection;
  status?: GitChanges;
}) => {
  const entries = orderedChanges(status);
  if (entries.length === 0) {
    return undefined;
  }
  const selectedIndex = entries.findIndex((change) =>
    sameChange(change, selectedChange),
  );
  const initialIndex = direction === 1 ? 0 : entries.length - 1;
  return entries[
    selectedIndex < 0
      ? initialIndex
      : cycleIndex(selectedIndex, entries.length, direction)
  ];
};
