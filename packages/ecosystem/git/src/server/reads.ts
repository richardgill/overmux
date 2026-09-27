// Orchestrates complete resource reads, releasing captured texts after each bounded batch.
import type {
  GitChanges,
  GitComparison,
  GitDiff,
  GitFileChange,
} from "../shared";
import {
  listFileComparisons,
  selectFileComparison,
  type FileComparison,
} from "./comparisons";
import { readContents } from "./contents";
import { buildFileDiff } from "./diff";
import { readBranch, type Repository } from "./repository";

type ReadOptions = {
  repository: Repository;
  signal: AbortSignal;
  contextLines: number;
};

const computedCounts = (diff: GitDiff) =>
  diff.binary
    ? null
    : diff.hunks
        .flatMap((hunk) => hunk.lines)
        .reduce(
          (counts, line) => ({
            added: counts.added + Number(line.kind === "added"),
            deleted: counts.deleted + Number(line.kind === "removed"),
          }),
          { added: 0, deleted: 0 },
        );

const changeSummary = (
  repository: Repository,
  comparison: GitComparison,
  contextLines: number,
  file: FileComparison,
): GitFileChange => {
  if (!file.status) {
    throw new Error("Changed file has no status");
  }
  return {
    path: file.path,
    ...(file.previousPath === undefined
      ? {}
      : { previousPath: file.previousPath }),
    status: file.status,
    binary: file.binary,
    lineStats: file.lineStats ?? null,
    diffParams: {
      repoRoot: repository.repoRoot,
      file: file.path,
      comparison,
      contextLines,
    },
  };
};

const readDetailedChanges = async ({
  repository,
  comparison,
  files,
  detailLevel,
  contextLines,
  signal,
}: ReadOptions & {
  comparison: GitComparison;
  files: readonly FileComparison[];
  detailLevel: "hunks" | "full";
}): Promise<GitFileChange[]> => {
  const changes: GitFileChange[] = [];

  // Four files bound both blob-batch memory and concurrent working-file I/O. The
  // retained value must drop full texts here for hunks-only responses, not later.
  for (let offset = 0; offset < files.length; offset += 4) {
    signal.throwIfAborted();
    const batch = files.slice(offset, offset + 4);
    const contents = await readContents({ repository, files: batch, signal });
    contents.forEach((captured, index) => {
      signal.throwIfAborted();
      const diff = buildFileDiff({ contents: captured, contextLines });
      const file = batch[index]!;
      changes.push({
        ...changeSummary(repository, comparison, contextLines, file),
        binary: diff.binary,
        lineStats: computedCounts(diff),
        diff:
          detailLevel === "hunks"
            ? { hunks: diff.hunks }
            : {
                hunks: diff.hunks,
                oldContent: diff.oldContent,
                newContent: diff.newContent,
              },
      });
    });
  }
  return changes;
};

export const readChanges = async ({
  repository,
  comparisons,
  detailLevel,
  contextLines,
  signal,
}: ReadOptions & {
  comparisons: Record<string, GitComparison>;
  detailLevel: "summary" | "hunks" | "full";
}): Promise<GitChanges> => {
  const branch = await readBranch({ repository, signal });
  const groups: [string, GitFileChange[]][] = [];

  for (const [name, comparison] of Object.entries(comparisons)) {
    const files = await listFileComparisons({
      repository,
      comparison,
      includeStats: detailLevel === "summary",
      signal,
    });

    const changes =
      detailLevel === "summary"
        ? files.map((file) =>
            changeSummary(repository, comparison, contextLines, file),
          )
        : await readDetailedChanges({
            repository,
            comparison,
            files,
            detailLevel,
            contextLines,
            signal,
          });
    groups.push([name, changes]);
  }

  return {
    repoRoot: repository.repoRoot,
    branch,
    comparisons: Object.fromEntries(groups),
  };
};

export const readDiff = async ({
  repository,
  file,
  comparison,
  contextLines,
  signal,
}: ReadOptions & {
  file: string;
  comparison: GitComparison;
}): Promise<GitDiff> => {
  const selected = await selectFileComparison({
    repository,
    comparison,
    file,
    signal,
  });
  const contents = await readContents({
    repository,
    files: [selected],
    signal,
  });
  signal.throwIfAborted();
  if (contents.length !== 1 || !contents[0]) {
    throw new Error("Expected exactly one selected file content");
  }
  return buildFileDiff({ contents: contents[0], contextLines });
};
