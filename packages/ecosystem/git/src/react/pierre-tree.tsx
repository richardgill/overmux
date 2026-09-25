import type {
  FileTreeRowDecorationContext,
  GitStatusEntry,
} from "@pierre/trees";
import {
  FileTree,
  useFileTree,
  useFileTreeSelector,
} from "@pierre/trees/react";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";

import type { GitChange } from "../shared";

type PierreGitChangeTreeProps = {
  area: GitChange["area"];
  changeClassName?: string;
  changes: GitChange[];
  flattenEmptyDirectories?: boolean;
  onSelectChange?: (change: GitChange) => void;
  selectedChange?: { area: GitChange["area"]; path: string };
  title: string;
};

type TreeState = {
  changeByPath: Map<string, GitChange>;
  onSelectChange?: (change: GitChange) => void;
};

const itemHeight = 28;
const customLabelStyles = `
[data-file-tree-virtualized-scroll="true"] { overflow-y: hidden; scrollbar-gutter: auto; }
[data-item-section="decoration"] { min-width: 0; justify-content: flex-start; overflow: hidden; text-align: start; }
[data-item-section="decoration"] > span { display: flex; min-width: 0; width: 100%; }
[data-item-section="decoration"] > span > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-item-contains-git-change="true"]:not([data-item-git-status]) > [data-item-section="git"] { display: none; }
`;

const getVisibleRowCount = (paths: readonly string[]) => {
  const visiblePaths = new Set(paths);
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      visiblePaths.add(`${segments.slice(0, index).join("/")}/`);
    }
  }
  return visiblePaths.size;
};

const usePierreGitChangeTree = ({
  area,
  changes,
  flattenEmptyDirectories,
  onSelectChange,
  selectedChange,
}: PierreGitChangeTreeProps) => {
  const changeByPath = useMemo(
    () => new Map(changes.map((change) => [change.path, change])),
    [changes],
  );
  const paths = useMemo(() => changes.map((change) => change.path), [changes]);
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => changes.map(({ path, status }) => ({ path, status })),
    [changes],
  );
  const selectedPath =
    selectedChange?.area === area ? selectedChange.path : undefined;
  const stateRef = useRef<TreeState>({ changeByPath, onSelectChange });
  stateRef.current = { changeByPath, onSelectChange };
  const syncingSelectionRef = useRef(false);
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      if (syncingSelectionRef.current) {
        return;
      }
      const change = stateRef.current.changeByPath.get(
        selectedPaths.at(-1) ?? "",
      );
      if (change) {
        stateRef.current.onSelectChange?.(change);
      }
    },
    [],
  );
  const renderRowDecoration = useCallback(
    ({ item }: FileTreeRowDecorationContext) => {
      const change = stateRef.current.changeByPath.get(item.path);
      if (!change) {
        return null;
      }
      const name = change.path.split("/").at(-1) ?? change.path;
      return { parts: [{ text: name }], text: name, title: item.path };
    },
    [],
  );
  const id = `om-git-${area}-${useId().replaceAll(":", "")}`;
  const { model } = useFileTree({
    flattenEmptyDirectories,
    gitStatus,
    id,
    initialExpansion: "open",
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    initialVisibleRowCount: getVisibleRowCount(paths),
    itemHeight,
    onSelectionChange: handleSelectionChange,
    paths,
    renderRowDecoration,
    unsafeCSS: customLabelStyles,
  });
  useEffect(() => {
    const currentPaths = model.getSelectedPaths();
    if (
      currentPaths.length === (selectedPath ? 1 : 0) &&
      currentPaths[0] === selectedPath
    ) {
      return;
    }
    syncingSelectionRef.current = true;
    currentPaths.forEach((path) => model.getItem(path)?.deselect());
    if (selectedPath) {
      model.getItem(selectedPath)?.select();
    }
    syncingSelectionRef.current = false;
  }, [model, selectedPath]);
  return { changeByPath, id, model, selectedPath };
};

export const PierreGitChangeTree = (props: PierreGitChangeTreeProps) => {
  const { changeByPath, id, model, selectedPath } =
    usePierreGitChangeTree(props);
  const visibleRowCount = useFileTreeSelector(model, (tree) =>
    tree.getVisibleCount(),
  );
  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    const rows =
      document
        .getElementById(id)
        ?.shadowRoot?.querySelectorAll<HTMLElement>("[data-item-path]") ?? [];
    [...rows]
      .find((row) => row.dataset.itemPath === selectedPath)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [id, selectedPath, visibleRowCount]);
  useEffect(() => {
    const shadowRoot = document.getElementById(id)?.shadowRoot;
    if (!shadowRoot) {
      return;
    }
    const applyAccessiblePaths = () =>
      shadowRoot
        .querySelectorAll<HTMLElement>("[data-item-path]")
        .forEach((row) => {
          const path = row.dataset.itemPath;
          if (path && changeByPath.has(path)) {
            row.setAttribute("aria-label", path);
          }
        });
    applyAccessiblePaths();
    const observer = new MutationObserver(applyAccessiblePaths);
    observer.observe(shadowRoot, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [changeByPath, id]);
  return (
    <FileTree
      aria-label={`${props.title} changes`}
      className={["om-git-change-tree", props.changeClassName]
        .filter(Boolean)
        .join(" ")}
      data-om-area={props.area}
      data-om-selected={selectedPath ? "true" : undefined}
      id={id}
      model={model}
      style={{ height: `${visibleRowCount * itemHeight}px` }}
    />
  );
};
