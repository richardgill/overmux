// Parses `git status --porcelain=v2 -z --branch --untracked-files=all`.
// "Porcelain" is Git's stable machine-readable format rather than its human UI.
// `-z` separates records with NUL bytes so paths can safely contain whitespace.
// Format reference: https://git-scm.com/docs/git-status#_porcelain_format_version_2

import type { GitBranch } from "../shared";

export type ParsedStatusChange = {
  area: "conflict" | "staged" | "unstaged";
  code: string;
  path: string;
  previousPath?: string;
  trackedSubmodule: boolean;
};

export type ParsedGitStatus = {
  branch: GitBranch;
  changes: ParsedStatusChange[];
};

// Git emits `N...` for normal files and an `S` prefix for tracked submodules.
const isTrackedSubmodule = (value: string) => value.startsWith("S");

// Git calls the staging area "the index" and files on disk "the worktree".
// Every tracked-file record has an XY code: X describes the index, Y the worktree.
// For example, `M.` is staged only, `.M` is unstaged only, and `MM` produces both.
const addIndexAndWorktreeChanges = ({
  changes,
  file,
  xy,
}: {
  changes: ParsedStatusChange[];
  file: Omit<ParsedStatusChange, "area" | "code">;
  xy: string;
}) => {
  const [indexCode, worktreeCode] = xy;
  if (indexCode && indexCode !== ".") {
    changes.push({ ...file, area: "staged", code: indexCode });
  }
  if (worktreeCode && worktreeCode !== ".") {
    // A staged rename's source belongs to HEAD, not to the index-to-worktree comparison.
    const { previousPath: _previousPath, ...worktreeFile } = file;
    changes.push({ ...worktreeFile, area: "unstaged", code: worktreeCode });
  }
};

// Branch headers look like `# branch.head main` and `# branch.ab +2 -1`.
// The latter means the local branch is two commits ahead and one behind upstream.
const parseBranchHeader = (record: string, branch: GitBranch) => {
  if (record.startsWith("# branch.head ")) {
    const head = record.slice(14);
    if (head !== "(detached)") {
      branch.name = head;
    }
    return;
  }
  if (record.startsWith("# branch.oid ")) {
    branch.unborn = record.slice(13) === "(initial)";
    return;
  }
  if (record.startsWith("# branch.upstream ")) {
    branch.upstream = record.slice(18);
    return;
  }
  const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
  if (match) {
    branch.ahead = Number(match[1]);
    branch.behind = Number(match[2]);
  }
};

// Type `1` is an ordinary tracked file: `1 <XY> <sub> <modes> <ids> <path>`.
// Example: `1 .M N... 100644 100644 100644 abc123 def456 src/app.ts`.
// Modes and object IDs are matched but discarded because the public model does not use them.
const parseOrdinary = (record: string, changes: ParsedStatusChange[]) => {
  const match =
    /^1 (?<xy>..) (?<submodule>....) \S+ \S+ \S+ \S+ \S+ (?<path>.*)$/s.exec(
      record,
    );
  if (!match) {
    throw new Error("Invalid porcelain v2 ordinary record");
  }
  const { path = "", submodule = "N...", xy = "" } = match.groups ?? {};
  addIndexAndWorktreeChanges({
    changes,
    file: { path, trackedSubmodule: isTrackedSubmodule(submodule) },
    xy,
  });
};

// Type `2` is a rename or copy and includes a score such as `R100`.
// With `-z`, Git emits the new path in this record and the old path after the next NUL.
// Example: `2 R. N... <modes> <ids> R100 new-name.ts\0old-name.ts`.
const parseRename = (
  record: string,
  previousPath: string | undefined,
  changes: ParsedStatusChange[],
) => {
  const match =
    /^2 (?<xy>..) (?<submodule>....) \S+ \S+ \S+ \S+ \S+ \S+ (?<path>.*)$/s.exec(
      record,
    );
  if (!match || previousPath === undefined) {
    throw new Error("Invalid porcelain v2 rename record");
  }
  const { path = "", submodule = "N...", xy = "" } = match.groups ?? {};
  addIndexAndWorktreeChanges({
    changes,
    file: {
      path,
      previousPath,
      trackedSubmodule: isTrackedSubmodule(submodule),
    },
    xy,
  });
};

// Type `u` means Git could not merge the file automatically.
// Example: `u UU N... <modes> <object IDs> src/conflicted.ts`.
const parseUnmerged = (record: string, changes: ParsedStatusChange[]) => {
  const match =
    /^u (?<xy>..) (?<submodule>....) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (?<path>.*)$/s.exec(
      record,
    );
  if (!match) {
    throw new Error("Invalid porcelain v2 unmerged record");
  }
  const { path = "", submodule = "N...", xy = "UU" } = match.groups ?? {};
  changes.push({
    area: "conflict",
    code: xy,
    path,
    trackedSubmodule: isTrackedSubmodule(submodule),
  });
};

// Returns how many following NUL-separated fields belong to this record.
// Only renames consume another field because their old path follows the main record.
const parseChangeRecord = (
  record: string,
  next: string | undefined,
  changes: ParsedStatusChange[],
) => {
  if (record.startsWith("1 ")) {
    parseOrdinary(record, changes);
    return 0;
  }
  if (record.startsWith("2 ")) {
    parseRename(record, next, changes);
    return 1;
  }
  if (record.startsWith("u ")) {
    parseUnmerged(record, changes);
    return 0;
  }
  // `? path` is an untracked file, which Git treats as a worktree-only change.
  if (record.startsWith("? ")) {
    changes.push({
      area: "unstaged",
      code: "?",
      path: record.slice(2),
      trackedSubmodule: false,
    });
    return 0;
  }
  // `! path` is ignored; our command does not request these, but skipping is harmless.
  if (record.startsWith("! ")) {
    return 0;
  }
  throw new Error("Invalid porcelain v2 record type");
};

export const parseGitStatus = (output: Buffer | string): ParsedGitStatus => {
  const records = output.toString().split("\0").filter(Boolean);
  const branch: GitBranch = {
    name: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    unborn: false,
  };
  const changes: ParsedStatusChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.startsWith("# ")) {
      parseBranchHeader(record, branch);
    } else {
      const additionalRecords = parseChangeRecord(
        record,
        records[index + 1],
        changes,
      );
      index += additionalRecords;
    }
  }
  return { branch, changes };
};
