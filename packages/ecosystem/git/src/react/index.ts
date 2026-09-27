// Public React views compose named comparisons with independent selected-file diff results.
export {
  GitSourceControlSidebar,
  registerGitDiffTheme,
  SourceControlView,
  type GitSourceControlSidebarProps,
  type SourceControlViewProps,
} from "./source-control-view";
export {
  PierreFileDiff,
  PierrePatchDiff,
  type GitDiffOptions,
  type GitDiffStyle,
  type PierreFileDiffProps,
  type PierrePatchDiffProps,
} from "./pierre-diff";
export {
  orderedChanges,
  sourceControlCommands,
  type GitChangeSelection,
  type SelectedGitChange,
  type SourceControlCommandHandles,
} from "./source-control-navigation";
