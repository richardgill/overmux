import { prepareFileTreeInput } from "@pierre/trees";
import { defineCommandRegistry } from "overmux/client";

import type { GitChange, GitStatus } from "../shared";

type Direction = 1 | -1;

export type GitChangeSelection = { area: GitChange["area"]; path: string };
const areaOrder = ["conflict", "unstaged", "staged"] as const;

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

export const orderedChanges = (status?: GitStatus) =>
  areaOrder.flatMap((area) =>
    sortPaths(status?.changes.filter((change) => change.area === area) ?? []),
  );

export const sameChange = (
  change: GitChangeSelection,
  selection?: GitChangeSelection,
) => change.area === selection?.area && change.path === selection?.path;

const cycleIndex = (index: number, length: number, direction: Direction) =>
  (index + direction + length) % length;

export const navigateChange = ({
  direction,
  selectedChange,
  status,
}: {
  direction: Direction;
  selectedChange?: GitChangeSelection;
  status?: GitStatus;
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
