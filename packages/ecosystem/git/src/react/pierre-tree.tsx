import type {
  ContextMenuItem,
  ContextMenuOpenContext,
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
  actionsClassName?: string;
  area?: GitChange["area"];
  changeClassName?: string;
  changes: GitChange[];
  flattenEmptyDirectories?: boolean;
  onDiscard?: (change: GitChange) => void;
  onSelectChange?: (change: GitChange) => void;
  onStage?: (change: GitChange) => void;
  onUnstage?: (change: GitChange) => void;
  getChangeLabel?: (change: GitChange) => number | string | null | undefined;
  selectedChange?: { area?: GitChange["area"]; path: string };
  title: string;
};

type TreeState = {
  changeByPath: Map<string, GitChange>;
  getChangeLabel?: PierreGitChangeTreeProps["getChangeLabel"];
  onSelectChange?: (change: GitChange) => void;
};

type ChangeContextMenuProps = Pick<
  PierreGitChangeTreeProps,
  "actionsClassName" | "onDiscard" | "onStage" | "onUnstage"
> & {
  changeByPath: Map<string, GitChange>;
  context: ContextMenuOpenContext;
  item: ContextMenuItem;
};

const itemHeight = 28;
const customLabelStyles = `
[data-file-tree-virtualized-scroll="true"] {
  overflow-y: hidden;
  scrollbar-gutter: auto;
}
[data-type="item"]:has([data-item-section="decoration"] > span) > [data-item-section="content"] {
  display: none;
}
[data-item-section="decoration"] {
  min-width: 0;
  justify-content: flex-start;
  overflow: hidden;
  text-align: start;
}
[data-item-section="decoration"] > span {
  display: flex;
  gap: 0.375rem;
  min-width: 0;
  width: 100%;
}
[data-item-section="decoration"] > span > span:first-child {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-item-section="decoration"] > span > span:not(:first-child) {
  flex: none;
  white-space: nowrap;
}
[data-type="item"][data-item-selected="true"]::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: var(--trees-border-radius);
  outline: var(--trees-focus-ring-width) solid var(--trees-selected-focused-border-color);
  outline-offset: var(--trees-focus-ring-offset);
  pointer-events: none;
}
[data-item-contains-git-change="true"]:not([data-item-git-status]) > [data-item-section="git"] {
  display: none;
}
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

const hasChangeActions = ({
  area,
  onDiscard,
  onStage,
  onUnstage,
}: Pick<
  PierreGitChangeTreeProps,
  "area" | "onDiscard" | "onStage" | "onUnstage"
>) =>
  (area === "unstaged" && Boolean(onStage || onDiscard)) ||
  (area === "staged" && Boolean(onUnstage));

const ChangeContextMenu = ({
  actionsClassName,
  changeByPath,
  context,
  item,
  onDiscard,
  onStage,
  onUnstage,
}: ChangeContextMenuProps) => {
  const change = changeByPath.get(item.path);
  if (!change) {
    return null;
  }
  return (
    <div
      className={["om-git-change-actions", actionsClassName]
        .filter(Boolean)
        .join(" ")}
      role="menu"
    >
      {change.area === "unstaged" && onStage ? (
        <button
          onClick={() => {
            onStage(change);
            context.close();
          }}
          role="menuitem"
          type="button"
        >
          Stage
        </button>
      ) : null}
      {change.area === "staged" && onUnstage ? (
        <button
          onClick={() => {
            onUnstage(change);
            context.close();
          }}
          role="menuitem"
          type="button"
        >
          Unstage
        </button>
      ) : null}
      {change.area === "unstaged" && onDiscard ? (
        <button
          onClick={() => {
            onDiscard(change);
            context.close();
          }}
          role="menuitem"
          type="button"
        >
          Discard
        </button>
      ) : null}
    </div>
  );
};

const usePierreGitChangeTree = ({
  area,
  changes,
  flattenEmptyDirectories,
  onSelectChange,
  getChangeLabel,
  selectedChange,
}: Pick<
  PierreGitChangeTreeProps,
  | "area"
  | "changes"
  | "flattenEmptyDirectories"
  | "getChangeLabel"
  | "onSelectChange"
  | "selectedChange"
>) => {
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
    selectedChange?.area === area ? selectedChange?.path : undefined;
  const stateRef = useRef<TreeState>({
    changeByPath,
    getChangeLabel,
    onSelectChange,
  });
  stateRef.current = { changeByPath, getChangeLabel, onSelectChange };
  const syncingSelectionRef = useRef(false);
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      if (syncingSelectionRef.current) {
        return;
      }
      const path = selectedPaths.at(-1);
      const change = path ? stateRef.current.changeByPath.get(path) : undefined;
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
      const customLabel = stateRef.current.getChangeLabel?.(change);
      const name =
        typeof customLabel === "string" || typeof customLabel === "number"
          ? String(customLabel)
          : (change.path.split("/").at(-1) ?? change.path);
      const additions = `+${change.insertions}`;
      const deletions = `-${change.deletions}`;
      return {
        parts: [
          { text: name },
          { color: "#3fb950", text: additions },
          { color: "#f85149", text: deletions },
        ],
        text: `${name} ${additions} ${deletions}`,
        title: item.path,
      };
    },
    [],
  );
  const id = `om-git-${area}-${useId().replaceAll(":", "")}`;
  const visibleRowCount = getVisibleRowCount(paths);
  const { model } = useFileTree({
    composition: {
      contextMenu: { enabled: true, triggerMode: "right-click" },
    },
    flattenEmptyDirectories,
    gitStatus,
    id,
    initialExpansion: "open",
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    initialVisibleRowCount: visibleRowCount,
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

const PierreGitChangeTreeModel = ({
  actionsClassName,
  area,
  changeClassName,
  changes,
  flattenEmptyDirectories,
  onDiscard,
  onSelectChange,
  onStage,
  onUnstage,
  getChangeLabel,
  selectedChange,
  title,
}: PierreGitChangeTreeProps) => {
  const { changeByPath, id, model, selectedPath } = usePierreGitChangeTree({
    area,
    changes,
    flattenEmptyDirectories,
    getChangeLabel,
    onSelectChange,
    selectedChange,
  });
  const visibleRowCount = useFileTreeSelector(model, (tree) =>
    tree.getVisibleCount(),
  );
  const hasActions = hasChangeActions({ area, onDiscard, onStage, onUnstage });
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
    const host = document.getElementById(id);
    const shadowRoot = host?.shadowRoot;
    if (!shadowRoot) {
      return;
    }
    const applyAccessiblePaths = () => {
      shadowRoot
        .querySelectorAll<HTMLElement>("[data-item-path]")
        .forEach((row) => {
          const path = row.dataset.itemPath;
          if (path && changeByPath.has(path)) {
            row.setAttribute("aria-label", path);
          }
        });
    };
    applyAccessiblePaths();
    const observer = new MutationObserver(applyAccessiblePaths);
    observer.observe(shadowRoot, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [changeByPath, id, model]);
  const renderContextMenu = useCallback(
    (item: ContextMenuItem, context: ContextMenuOpenContext) => (
      <ChangeContextMenu
        actionsClassName={actionsClassName}
        changeByPath={changeByPath}
        context={context}
        item={item}
        onDiscard={onDiscard}
        onStage={onStage}
        onUnstage={onUnstage}
      />
    ),
    [actionsClassName, changeByPath, onDiscard, onStage, onUnstage],
  );

  return (
    <FileTree
      aria-label={`${title} changes`}
      className={["om-git-change-tree", changeClassName]
        .filter(Boolean)
        .join(" ")}
      data-om-area={area}
      data-om-selected={selectedPath ? "true" : undefined}
      id={id}
      model={model}
      renderContextMenu={hasActions ? renderContextMenu : undefined}
      style={{ height: `${visibleRowCount * itemHeight}px` }}
    />
  );
};

export const PierreGitChangeTree = (props: PierreGitChangeTreeProps) => {
  const modelKey = JSON.stringify([
    props.flattenEmptyDirectories,
    props.changes.map((change) => [
      change.path,
      change.status,
      change.insertions,
      change.deletions,
      props.getChangeLabel?.(change),
    ]),
  ]);
  return <PierreGitChangeTreeModel {...props} key={modelKey} />;
};
