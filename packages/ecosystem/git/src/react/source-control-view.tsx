import "./styles.css";

import { useCommand } from "overmux/client";
import { SplitView } from "@overmux/ui";
import { registerCustomTheme } from "@pierre/diffs";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PierreFileDiff,
  type GitDiffOptions,
  type GitDiffStyle,
} from "./pierre-diff";
import { PierreGitChangeTree } from "./pierre-tree";
import {
  navigateChange,
  orderedChanges,
  sameChange,
  type GitChangeSelection,
  type SourceControlCommandHandles,
} from "./source-control-navigation";
import type { GitChange, GitDiff, GitStatus } from "../shared";

export const registerGitDiffTheme = registerCustomTheme;

type OvermuxStyle = CSSProperties &
  Record<`--${string}`, string | number | undefined>;
const joinClassNames = (...names: Array<string | undefined>) =>
  names.filter(Boolean).join(" ");

type GitSourceControlSidebarClassNames = Partial<{
  change: string;
  empty: string;
  error: string;
  group: string;
  header: string;
  loading: string;
  root: string;
}>;
export type GitSourceControlSidebarProps = {
  className?: string;
  classNames?: GitSourceControlSidebarClassNames;
  emptyState?: ReactNode;
  error?: Error | string;
  flattenEmptyDirectories?: boolean;
  loading?: boolean;
  onSelectChange?: (change: GitChange) => void;
  selectedChange?: GitChangeSelection;
  status?: GitStatus;
  style?: OvermuxStyle;
};

const groups = [
  { area: "conflict", title: "Conflicts" },
  { area: "unstaged", title: "Unstaged" },
  { area: "staged", title: "Staged" },
] as const;

export const GitSourceControlSidebar = ({
  className,
  classNames,
  emptyState,
  error,
  flattenEmptyDirectories,
  loading = false,
  onSelectChange,
  selectedChange,
  status,
  style,
}: GitSourceControlSidebarProps) => {
  if (error) {
    return (
      <p className={classNames?.error} role="alert">
        {String(error)}
      </p>
    );
  }
  if (loading) {
    return (
      <p className={classNames?.loading} role="status">
        Loading changes…
      </p>
    );
  }
  if (!status || !status.changes.length) {
    return <p className={classNames?.empty}>{emptyState ?? "No changes."}</p>;
  }
  return (
    <aside
      aria-label="Git changes"
      className={joinClassNames(
        "om-git-changes-sidebar",
        className,
        classNames?.root,
      )}
      data-om-git-changes-sidebar
      style={style}
    >
      <header
        className={joinClassNames("om-git-changes-header", classNames?.header)}
      >
        {status.branch.name ?? status.repoRoot}
      </header>
      {groups.map(({ area, title }) => {
        const changes = status.changes.filter((change) => change.area === area);
        return changes.length ? (
          <section
            className={joinClassNames(
              "om-git-changes-group",
              classNames?.group,
            )}
            key={area}
          >
            <h2>{title}</h2>
            <PierreGitChangeTree
              area={area}
              changeClassName={classNames?.change}
              changes={changes}
              flattenEmptyDirectories={flattenEmptyDirectories}
              onSelectChange={onSelectChange}
              selectedChange={selectedChange}
              title={title}
            />
          </section>
        ) : null;
      })}
    </aside>
  );
};

type GitDiffClassNames = Partial<{
  binary: string;
  empty: string;
  error: string;
  file: string;
  header: string;
  loading: string;
  patch: string;
  root: string;
}>;

type SourceControlViewClassNames = Partial<{
  diff: string;
  root: string;
  separator: string;
  separatorFocused: string;
  sidebar: string;
  split: string;
}>;
export type SourceControlViewProps = Omit<
  GitSourceControlSidebarProps,
  "classNames" | "onSelectChange" | "selectedChange" | "status"
> & {
  active?: boolean;
  className?: string;
  classNames?: SourceControlViewClassNames;
  commandHandles?: SourceControlCommandHandles;
  defaultSidebarWidth?: number;
  diff?: GitDiff;
  diffClassNames?: GitDiffClassNames;
  diffLoading?: boolean;
  diffOptions?: GitDiffOptions;
  diffStyle?: GitDiffStyle;
  maxSidebarWidth?: number;
  minSidebarWidth?: number;
  onSelectChange?: (change: GitChange) => void;
  onSidebarWidthChange?: (width: number) => void;
  renderDiffFileHeader?: (diff: GitDiff) => ReactNode;
  selectedChange?: GitChangeSelection;
  sidebarWidth?: number;
  status?: GitStatus;
  style?: OvermuxStyle;
};

const isEditableEvent = (event: KeyboardEvent) =>
  event
    .composedPath()
    .some(
      (target) =>
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select, [contenteditable='true']")),
    );

const CommandTargets = ({
  active,
  commandHandles,
  nextFile,
  previousFile,
  rootRef,
  scrollDown,
  scrollUp,
}: {
  active: boolean;
  commandHandles: SourceControlCommandHandles;
  nextFile: () => void;
  previousFile: () => void;
  rootRef: RefObject<HTMLDivElement | null>;
  scrollDown: () => void;
  scrollUp: () => void;
}) => {
  useCommand(commandHandles["sourceControl.nextFile"], {
    element: rootRef,
    enabled: active,
    run: nextFile,
  });
  useCommand(commandHandles["sourceControl.previousFile"], {
    element: rootRef,
    enabled: active,
    run: previousFile,
  });
  useCommand(commandHandles["sourceControl.scrollDown"], {
    element: rootRef,
    enabled: active,
    run: scrollDown,
  });
  useCommand(commandHandles["sourceControl.scrollUp"], {
    element: rootRef,
    enabled: active,
    run: scrollUp,
  });
  return null;
};

type GitDiffPaneProps = {
  active: boolean;
  classNames?: SourceControlViewClassNames;
  diff?: GitDiff;
  diffClassNames?: GitDiffClassNames;
  diffLoading: boolean;
  diffOptions?: GitDiffOptions;
  diffStyle: GitDiffStyle;
  error?: Error | string;
  onActive: () => void;
  paneRef: RefObject<HTMLDivElement | null>;
  renderDiffFileHeader?: (diff: GitDiff) => ReactNode;
  selectedChange?: GitChange;
};

const GitDiffPane = ({
  active,
  classNames,
  diff,
  diffClassNames,
  diffLoading,
  diffOptions,
  diffStyle,
  error,
  onActive,
  paneRef,
  renderDiffFileHeader,
  selectedChange,
}: GitDiffPaneProps) => {
  const selected = selectedChange;
  // A subscription can resolve after selection changes, so never render its stale file.
  const selectedDiff = diff?.file === selected?.path ? diff : undefined;
  return (
    <div
      className={joinClassNames("om-source-control-diff", classNames?.diff)}
      data-om-pane-active={active ? "true" : undefined}
      onFocusCapture={onActive}
      onPointerDownCapture={onActive}
      ref={paneRef}
      tabIndex={-1}
    >
      {error ? (
        <p className={diffClassNames?.error} role="alert">
          {String(error)}
        </p>
      ) : diffLoading ? (
        <p className={diffClassNames?.loading} role="status">
          Loading diff…
        </p>
      ) : !selected ? (
        <p className={diffClassNames?.empty}>No diff.</p>
      ) : !selectedDiff ? (
        <p className={diffClassNames?.empty}>No diff available.</p>
      ) : (
        <section
          aria-label="Git diff"
          className={joinClassNames("om-git-diff", diffClassNames?.root)}
          data-om-git-diff
        >
          <article
            className={joinClassNames("om-git-diff-file", diffClassNames?.file)}
            data-om-binary={selectedDiff.binary || undefined}
            data-om-git-file={`${selected.area}:${selected.path}`}
          >
            <header
              className={joinClassNames(
                "om-git-diff-header",
                diffClassNames?.header,
              )}
            >
              <span className="om-git-diff-header-content">
                {renderDiffFileHeader?.(selectedDiff) ?? selectedDiff.file}
              </span>
            </header>
            {selectedDiff.binary ? (
              <p className={diffClassNames?.binary}>Binary file.</p>
            ) : selectedDiff.oldContent === selectedDiff.newContent ? (
              <p className={diffClassNames?.empty}>No textual changes.</p>
            ) : (
              <PierreFileDiff
                cacheKey={`${selected.area}:${selected.path}`}
                className={joinClassNames(
                  "om-git-diff-patch",
                  diffClassNames?.patch,
                )}
                diffStyle={diffStyle}
                newContent={selectedDiff.newContent}
                oldContent={selectedDiff.oldContent}
                options={diffOptions}
                path={selectedDiff.file}
                previousPath={selectedDiff.previousPath}
              />
            )}
          </article>
        </section>
      )}
    </div>
  );
};

export const SourceControlView = ({
  active = true,
  className,
  classNames,
  commandHandles,
  defaultSidebarWidth = 280,
  diff,
  diffClassNames,
  diffLoading = false,
  diffOptions,
  diffStyle = "unified",
  error,
  loading = false,
  maxSidebarWidth = 640,
  minSidebarWidth = 160,
  onSelectChange,
  onSidebarWidthChange,
  renderDiffFileHeader,
  selectedChange,
  sidebarWidth,
  status,
  style,
  ...sidebarProps
}: SourceControlViewProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const sidebarPaneRef = useRef<HTMLDivElement>(null);
  const diffPaneRef = useRef<HTMLDivElement>(null);
  const [activePane, setActivePane] = useState<"diff" | "sidebar">("diff");
  const [uncontrolledChange, setUncontrolledChange] =
    useState<GitChangeSelection>();
  const entries = useMemo(() => orderedChanges(status), [status]);
  const requestedChange = selectedChange ?? uncontrolledChange;
  const currentChange =
    entries.find((change) => sameChange(change, requestedChange)) ?? entries[0];
  // Consecutive key events must advance even before controlled props catch up.
  const currentChangeRef = useRef(currentChange);
  currentChangeRef.current = currentChange;
  const selectChange = useCallback(
    (change: GitChange) => {
      currentChangeRef.current = change;
      if (selectedChange === undefined) {
        setUncontrolledChange(change);
      }
      onSelectChange?.(change);
    },
    [onSelectChange, selectedChange],
  );
  const moveFile = useCallback(
    (direction: 1 | -1) => {
      const change = navigateChange({
        direction,
        selectedChange: currentChangeRef.current,
        status,
      });
      if (change) {
        selectChange(change);
      }
    },
    [selectChange, status],
  );
  const scrollDiff = useCallback(
    (direction: 1 | -1) =>
      diffPaneRef.current?.scrollBy?.({
        top: (diffPaneRef.current.clientHeight / 2) * direction,
      }),
    [],
  );
  const focusPane = useCallback((pane: "diff" | "sidebar") => {
    setActivePane(pane);
    if (pane === "diff") {
      diffPaneRef.current?.focus({ preventScroll: true });
    } else {
      sidebarPaneRef.current?.focus({ preventScroll: true });
    }
  }, []);
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const pane =
        event.key === "ArrowLeft"
          ? "sidebar"
          : event.key === "ArrowRight"
            ? "diff"
            : undefined;
      if (
        !pane ||
        !event.ctrlKey ||
        !event.shiftKey ||
        event.altKey ||
        event.metaKey ||
        isEditableEvent(event)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      focusPane(pane);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, focusPane]);
  return (
    <div
      className={joinClassNames(
        "om-source-control-view",
        className,
        classNames?.root,
      )}
      data-om-active={active ? "true" : undefined}
      data-om-source-control-view
      onKeyDown={(event) => {
        if (
          event.key !== "Tab" ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        moveFile(event.shiftKey ? -1 : 1);
      }}
      ref={rootRef}
      style={style}
    >
      {commandHandles ? (
        <CommandTargets
          active={active}
          commandHandles={commandHandles}
          nextFile={() => moveFile(1)}
          previousFile={() => moveFile(-1)}
          rootRef={rootRef}
          scrollDown={() => scrollDiff(1)}
          scrollUp={() => scrollDiff(-1)}
        />
      ) : null}
      <SplitView
        className={joinClassNames("om-source-control-split", classNames?.split)}
        defaultFirstPanelSize={defaultSidebarWidth}
        first={
          <div
            className={joinClassNames(
              "om-source-control-sidebar",
              classNames?.sidebar,
            )}
            data-om-pane-active={activePane === "sidebar" ? "true" : undefined}
            onFocusCapture={() => setActivePane("sidebar")}
            onPointerDownCapture={() => setActivePane("sidebar")}
            ref={sidebarPaneRef}
            tabIndex={-1}
          >
            <GitSourceControlSidebar
              {...sidebarProps}
              error={error}
              loading={loading}
              onSelectChange={selectChange}
              selectedChange={currentChange}
              status={status}
            />
          </div>
        }
        firstPanelSize={sidebarWidth}
        maxFirstPanelSize={maxSidebarWidth}
        minFirstPanelSize={minSidebarWidth}
        onFirstPanelSizeChange={onSidebarWidthChange}
        second={
          <GitDiffPane
            active={activePane === "diff"}
            classNames={classNames}
            diff={diff}
            diffClassNames={diffClassNames}
            diffLoading={diffLoading}
            diffOptions={diffOptions}
            diffStyle={diffStyle}
            error={error}
            onActive={() => setActivePane("diff")}
            paneRef={diffPaneRef}
            renderDiffFileHeader={renderDiffFileHeader}
            selectedChange={currentChange}
          />
        }
        separatorClassName={classNames?.separator}
        separatorFocusedClassName={classNames?.separatorFocused}
      />
    </div>
  );
};
