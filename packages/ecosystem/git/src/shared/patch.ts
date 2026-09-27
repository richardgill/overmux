import type { GitDiff, GitDiffHunk } from "./index";

const rangeKey = (hunk: GitDiffHunk) =>
  [hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount].join(":");

const selectHunks = (diff: GitDiff, hunks: GitDiffHunk[]) => {
  const requested = new Set(hunks.map(rangeKey));
  const selected = diff.hunks.filter((hunk) => requested.has(rangeKey(hunk)));
  if (requested.size !== hunks.length || selected.length !== hunks.length) {
    throw new Error("Select distinct hunks from the supplied Git diff");
  }
  if (
    !selected.some((hunk) => hunk.lines.some((line) => line.kind !== "context"))
  ) {
    throw new Error("Git patch requires at least one hunk with text changes");
  }
  return selected;
};

// Git's quoted paths use C escapes and octal UTF-8 bytes, not JSON escapes.
const quotePath = (path: string) =>
  `"${Array.from(new TextEncoder().encode(path), (byte) => {
    if (byte === 34 || byte === 92) {
      return `\\${String.fromCharCode(byte)}`;
    }
    if (byte >= 32 && byte < 127) {
      return String.fromCharCode(byte);
    }
    return `\\${byte.toString(8).padStart(3, "0")}`;
  }).join("")}"`;

const contentLines = (content: string | null) =>
  content?.match(/[^\n]*\n|[^\n]+$/g) ?? [];

const patchLine = (prefix: string, line: string | undefined) => {
  if (line === undefined) {
    throw new Error("Git hunk line is outside its captured content");
  }
  return line.endsWith("\n")
    ? `${prefix}${line}`
    : `${prefix}${line}\n\\ No newline at end of file\n`;
};

export const createGitPatch = ({
  diff,
  hunks = diff.hunks,
}: {
  diff: GitDiff;
  hunks?: GitDiffHunk[];
}): string => {
  if (diff.binary) {
    throw new Error("Cannot create a text patch for a binary Git diff");
  }
  if (diff.oldContent === null && diff.newContent === null) {
    throw new Error("Git diff file is absent on both sides");
  }
  if (diff.previousPath !== undefined && diff.previousPath !== diff.file) {
    throw new Error(
      "Git text patches do not support renamed files; use file operations instead",
    );
  }
  if (diff.oldContent === diff.newContent) {
    throw new Error("Git patch requires text changes");
  }

  // Select by captured ranges rather than identity, accepting copied hunks and
  // retaining the resource's original order and authoritative line numbers.
  const selected = selectHunks(diff, hunks);
  const oldLines = contentLines(diff.oldContent);
  const newLines = contentLines(diff.newContent);
  let selectedDelta = 0;
  const body = selected.map((hunk) => {
    const oldOffset = hunk.oldStart - Number(hunk.oldCount > 0);
    const newOffset = hunk.newStart - Number(hunk.newCount > 0);
    // git apply locates each fragment using its destination range, also when
    // reversed. Each destination must describe the partially edited side, not
    // the full diff with omitted edits. The two ranges deliberately differ from
    // a conventional partial diff so this same patch works in both directions.
    // Even empty ranges use the one-based insertion/removal position: Git's
    // usual preceding-line convention needs an offset search for deletions.
    const oldStart =
      diff.oldContent === null ? 0 : newOffset - selectedDelta + 1;
    const newStart =
      diff.newContent === null ? 0 : oldOffset + selectedDelta + 1;
    selectedDelta += hunk.newCount - hunk.oldCount;
    const lines = hunk.lines.map((line) => {
      if (line.kind === "added") {
        return patchLine("+", newLines[line.newLine - 1]);
      }
      return patchLine(
        line.kind === "removed" ? "-" : " ",
        oldLines[line.oldLine - 1],
      );
    });
    return `@@ -${oldStart},${hunk.oldCount} +${newStart},${hunk.newCount} @@\n${lines.join("")}`;
  });

  const before =
    diff.oldContent === null ? "/dev/null" : quotePath(`a/${diff.file}`);
  const after =
    diff.newContent === null ? "/dev/null" : quotePath(`b/${diff.file}`);
  return `--- ${before}\n+++ ${after}\n${body.join("")}`;
};
