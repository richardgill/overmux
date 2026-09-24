import "./styles.css";

import { useCommand } from "overmux/client";
import { SplitView } from "@overmux/ui";
import { registerCustomTheme } from "@pierre/diffs";
import type { CSSProperties, ReactNode, Ref, RefObject } from "react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

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
import {
  gitChangeKey,
  type GitChange,
  type GitSourceControl,
  type GitSourceControlFile,
} from "../shared";
export const registerGitDiffTheme = registerCustomTheme;

type OvermuxStyle = CSSProperties &
  Record<`--${string}`, string | number | undefined>;

const joinClassNames = (...names: Array<string | undefined>) =>
  names.filter(Boolean).join(" ");
type GitSourceControlSidebarClassNames = Partial<{
  actions: string;
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
  sourceControl?: GitSourceControl;
  emptyState?: ReactNode;
  error?: Error | string;
  flattenEmptyDirectories?: boolean;
  loading?: boolean;
  onDiscard?: (change: GitChange) => void;
  onSelectChange?: (change: GitChange) => void;
  onStage?: (change: GitChange) => void;
  onUnstage?: (change: GitChange) => void;
  getChangeLabel?: (change: GitChange) => number | string | null | undefined;
  selectedChange?: GitChangeSelection;
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
  sourceControl,
  error,
  loading = false,
  style,
  ...props
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
  if (!sourceControl || !sourceControl.changes.length) {
    return <p className={classNames?.empty}>{emptyState ?? "No changes."}</p>;
  }
  const entries = sourceControl.changes;
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
        {sourceControl.comparison === "uncommitted"
          ? (sourceControl.branch.name ?? sourceControl.root)
          : sourceControl.root}
      </header>
      {sourceControl.comparison === "base" ? (
        <section
          className={joinClassNames("om-git-changes-group", classNames?.group)}
        >
          <h2>Changes</h2>
          <PierreGitChangeTree
            actionsClassName={classNames?.actions}
            changeClassName={classNames?.change}
            changes={entries}
            flattenEmptyDirectories={props.flattenEmptyDirectories}
            getChangeLabel={props.getChangeLabel}
            onSelectChange={props.onSelectChange}
            selectedChange={props.selectedChange}
            title="Changes"
          />
        </section>
      ) : (
        groups.map(({ area, title }) => {
          const group = entries.filter((change) => change.area === area);
          return group.length ? (
            <section
              className={joinClassNames(
                "om-git-changes-group",
                classNames?.group,
              )}
              key={area}
            >
              <h2>{title}</h2>
              <PierreGitChangeTree
                {...props}
                actionsClassName={classNames?.actions}
                area={area}
                changeClassName={classNames?.change}
                changes={group}
                flattenEmptyDirectories={props.flattenEmptyDirectories}
                onDiscard={props.onDiscard}
                onSelectChange={props.onSelectChange}
                getChangeLabel={props.getChangeLabel}
                onStage={props.onStage}
                onUnstage={props.onUnstage}
                selectedChange={props.selectedChange}
                title={title}
              />
            </section>
          ) : null;
        })
      )}
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

type GitDiffFileProps = {
  cacheKey: string;
  classNames?: GitDiffClassNames;
  diff: GitSourceControlFile;
  diffOptions?: GitDiffOptions;
  diffStyle: GitDiffStyle;
};

const GitDiffFile = ({
  cacheKey,
  classNames,
  diff,
  diffOptions,
  diffStyle,
}: GitDiffFileProps) => {
  if (diff.binary) {
    return <p className={classNames?.binary}>Binary file.</p>;
  }
  if (diff.oldContent === diff.newContent) {
    return <p className={classNames?.empty}>No textual changes.</p>;
  }
  return (
    <PierreFileDiff
      className={joinClassNames("om-git-diff-patch", classNames?.patch)}
      cacheKey={cacheKey}
      diffStyle={diffStyle}
      newContent={diff.newContent}
      oldContent={diff.oldContent}
      options={diffOptions}
      path={diff.path}
      previousPath={diff.previousPath}
    />
  );
};

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
  "classNames" | "onSelectChange" | "selectedChange" | "sourceControl"
> & {
  active?: boolean;
  className?: string;
  classNames?: SourceControlViewClassNames;
  commandHandles?: SourceControlCommandHandles;
  defaultSidebarWidth?: number;
  diffClassNames?: GitDiffClassNames;
  diffOptions?: GitDiffOptions;
  diffStyle?: GitDiffStyle;
  maxSidebarWidth?: number;
  minSidebarWidth?: number;
  onSelectChange?: (change: GitChange) => void;
  onSidebarWidthChange?: (width: number) => void;
  renderDiffFileHeader?: (file: GitSourceControlFile) => ReactNode;
  selectedChange?: GitChangeSelection;
  sidebarWidth?: number;
  sourceControl?: GitSourceControl;
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

type GitDiffPaneHandle = {
  focus: () => void;
  nextFile: () => void;
  previousFile: () => void;
  scrollDown: () => void;
  scrollUp: () => void;
  selectChange: (change: GitChange) => void;
};

type GitDiffPaneProps = {
  active: boolean;
  classNames?: SourceControlViewClassNames;
  diffClassNames?: GitDiffClassNames;
  diffOptions?: GitDiffOptions;
  diffStyle: GitDiffStyle;
  error?: Error | string;
  loading: boolean;
  onActive: () => void;
  onSelectChange: (change: GitChange) => void;
  renderDiffFileHeader?: (file: GitSourceControlFile) => ReactNode;
  selectedChange?: GitChangeSelection;
  sourceControl?: GitSourceControl;
  ref?: Ref<GitDiffPaneHandle>;
};

const GitDiffPane = ({
  active,
  classNames,
  diffClassNames,
  diffOptions,
  diffStyle,
  error,
  loading,
  onActive,
  onSelectChange,
  ref,
  renderDiffFileHeader,
  selectedChange,
  sourceControl,
}: GitDiffPaneProps) => {
  const paneRef = useRef<HTMLDivElement>(null);
  const fileRefs = useRef(new Map<string, HTMLElement>());
  const flashFileRef = useRef<HTMLElement>(undefined);
  const flashTimerRef = useRef<number>(undefined);
  const entries = useMemo(() => orderedChanges(sourceControl), [sourceControl]);
  const selectedChangeRef = useRef(selectedChange);
  selectedChangeRef.current = selectedChange;
  const registerFile = useCallback(
    (change: GitChange, element: HTMLElement | null) => {
      const key = gitChangeKey(change);
      if (element) {
        fileRefs.current.set(key, element);
      } else {
        fileRefs.current.delete(key);
      }
    },
    [],
  );
  const selectChange = useCallback(
    (change: GitChange, flash = false) => {
      selectedChangeRef.current = change;
      onSelectChange(change);
      const file = fileRefs.current.get(gitChangeKey(change));
      file?.scrollIntoView?.({ block: "start" });
      if (!file || !flash) {
        return;
      }
      flashFileRef.current?.removeAttribute("data-om-file-flash");
      file.getBoundingClientRect();
      file.setAttribute("data-om-file-flash", "true");
      flashFileRef.current = file;
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        file.removeAttribute("data-om-file-flash");
        if (flashFileRef.current === file) {
          flashFileRef.current = undefined;
        }
      }, 1400);
    },
    [onSelectChange],
  );
  const selectTopFile = useCallback(() => {
    const pane = paneRef.current;
    if (!pane) {
      return;
    }
    const readingLine = pane.getBoundingClientRect().top + 1;
    const visible =
      [...entries].reverse().find((change) => {
        const section = fileRefs.current.get(gitChangeKey(change));
        return Boolean(
          section && section.getBoundingClientRect().top <= readingLine,
        );
      }) ?? entries[0];
    if (visible && !sameChange(visible, selectedChangeRef.current)) {
      selectedChangeRef.current = visible;
      onSelectChange(visible);
    }
  }, [entries, onSelectChange]);
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) {
      return;
    }
    pane.addEventListener("scroll", selectTopFile, { passive: true });
    return () => pane.removeEventListener("scroll", selectTopFile);
  }, [selectTopFile]);
  useEffect(
    () => () => {
      window.clearTimeout(flashTimerRef.current);
      flashFileRef.current?.removeAttribute("data-om-file-flash");
    },
    [],
  );
  const moveFile = useCallback(
    (direction: 1 | -1) => {
      const change = navigateChange({
        direction,
        selectedChange: selectedChangeRef.current,
        sourceControl,
      });
      if (change) {
        selectChange(change, true);
      }
    },
    [selectChange, sourceControl],
  );
  const scrollDiff = useCallback((direction: 1 | -1) => {
    const pane = paneRef.current;
    pane?.scrollBy?.({ top: (pane.clientHeight / 2) * direction });
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => paneRef.current?.focus({ preventScroll: true }),
      nextFile: () => moveFile(1),
      previousFile: () => moveFile(-1),
      scrollDown: () => scrollDiff(1),
      scrollUp: () => scrollDiff(-1),
      selectChange,
    }),
    [moveFile, scrollDiff, selectChange],
  );
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
      ) : loading ? (
        <p className={diffClassNames?.loading} role="status">
          Loading diff…
        </p>
      ) : entries.length ? (
        <section
          aria-label="Git diff"
          className={joinClassNames("om-git-diff", diffClassNames?.root)}
          data-om-git-diff
        >
          {entries.map((change) => {
            const diff = sourceControl?.diffs[gitChangeKey(change)];
            if (!diff) {
              return null;
            }
            const cacheKey = `${sourceControl?.revision}:${gitChangeKey(change)}`;
            return (
              <article
                className={joinClassNames(
                  "om-git-diff-file",
                  diffClassNames?.file,
                )}
                data-om-binary={diff.binary || undefined}
                data-om-git-file={gitChangeKey(change)}
                key={gitChangeKey(change)}
                ref={(element) => registerFile(change, element)}
              >
                <header
                  className={joinClassNames(
                    "om-git-diff-header",
                    diffClassNames?.header,
                  )}
                >
                  <span className="om-git-diff-header-content">
                    {renderDiffFileHeader?.(diff) ?? diff.path}
                  </span>
                  <span
                    aria-label={`Insertions: ${change.insertions}; deletions: ${change.deletions}`}
                    className="om-git-diff-header-stats"
                  >
                    <span className="om-git-diff-stat-additions">
                      +{change.insertions}
                    </span>
                    <span className="om-git-diff-stat-deletions">
                      -{change.deletions}
                    </span>
                  </span>
                </header>
                <GitDiffFile
                  cacheKey={cacheKey}
                  classNames={diffClassNames}
                  diff={diff}
                  diffOptions={diffOptions}
                  diffStyle={diffStyle}
                />
              </article>
            );
          })}
        </section>
      ) : (
        <p className={diffClassNames?.empty}>No diff.</p>
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
  diffClassNames,
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
  sourceControl,
  style,
  ...sidebarProps
}: SourceControlViewProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const sidebarPaneRef = useRef<HTMLDivElement>(null);
  const diffPaneRef = useRef<GitDiffPaneHandle>(null);
  const [activePane, setActivePane] = useState<"diff" | "sidebar">("diff");
  const [uncontrolledChange, setUncontrolledChange] =
    useState<GitChangeSelection>();
  const entries = useMemo(() => orderedChanges(sourceControl), [sourceControl]);
  const initialChange = entries[0];
  const currentChange = selectedChange ?? uncontrolledChange ?? initialChange;
  const selectChange = useCallback(
    (change: GitChange) => {
      if (selectedChange === undefined) {
        setUncontrolledChange(change);
      }
      onSelectChange?.(change);
    },
    [onSelectChange, selectedChange],
  );
  const moveFile = (direction: 1 | -1) => {
    if (direction === 1) {
      diffPaneRef.current?.nextFile();
    } else {
      diffPaneRef.current?.previousFile();
    }
  };
  const scrollDiff = (direction: 1 | -1) => {
    if (direction === 1) {
      diffPaneRef.current?.scrollDown();
    } else {
      diffPaneRef.current?.scrollUp();
    }
  };
  const focusPane = useCallback((pane: "diff" | "sidebar") => {
    setActivePane(pane);
    if (pane === "diff") {
      diffPaneRef.current?.focus();
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
        const halfScrollDirection = ["ArrowDown", "d"].includes(event.key)
          ? 1
          : ["ArrowUp", "u"].includes(event.key)
            ? -1
            : undefined;
        if (
          event.repeat &&
          halfScrollDirection &&
          event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          scrollDiff(halfScrollDirection);
          return;
        }
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
              onSelectChange={(change) =>
                diffPaneRef.current?.selectChange(change)
              }
              selectedChange={currentChange}
              sourceControl={sourceControl}
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
            diffClassNames={diffClassNames}
            diffOptions={diffOptions}
            diffStyle={diffStyle}
            error={error}
            loading={loading}
            onActive={() => setActivePane("diff")}
            onSelectChange={selectChange}
            ref={diffPaneRef}
            renderDiffFileHeader={renderDiffFileHeader}
            selectedChange={currentChange}
            sourceControl={sourceControl}
          />
        }
        separatorClassName={classNames?.separator}
        separatorFocusedClassName={classNames?.separatorFocused}
      />
    </div>
  );
};
