// Converts one captured pair of byte buffers into faithful text and numbered hunks.
// No Git or filesystem reads happen here, so content and hunks cannot describe different reads.
import { isUtf8 } from "node:buffer";
import { structuredPatch, type StructuredPatchHunk } from "diff";

import type { GitDiff, GitDiffHunk, GitDiffLine } from "../shared";

export type DiffSides = {
  file: string;
  previousPath?: string;
  oldBytes: Buffer | null;
  newBytes: Buffer | null;
};
export const isBinary = (bytes: Buffer | null) =>
  bytes !== null && (bytes.includes(0) || !isUtf8(bytes));

const lineTexts = (content: string) =>
  (content.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((line) =>
    line.replace(/\r?\n$/, ""),
  );

const numberHunk = (
  hunk: StructuredPatchHunk,
  oldLines: string[],
  newLines: string[],
): GitDiffHunk => {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  const lines = hunk.lines.flatMap((line): GitDiffLine[] => {
    if (line.startsWith("-")) {
      return [
        { kind: "removed", text: oldLines[oldLine - 1]!, oldLine: oldLine++ },
      ];
    }
    if (line.startsWith("+")) {
      return [
        { kind: "added", text: newLines[newLine - 1]!, newLine: newLine++ },
      ];
    }
    if (line.startsWith(" ")) {
      return [
        {
          kind: "context",
          text: oldLines[oldLine - 1]!,
          oldLine: oldLine++,
          newLine: newLine++,
        },
      ];
    }
    // jsdiff's missing-newline marker isn't a source line. The actual replacement
    // still appears above; full texts retain the newline distinction for consumers.
    return [];
  });
  // jsdiff's structured ranges are one-based even when empty; unified diff uses
  // the preceding line for an empty range (zero when inserting at the start).
  return {
    oldStart: hunk.oldStart - (hunk.oldLines === 0 ? 1 : 0),
    oldCount: hunk.oldLines,
    newStart: hunk.newStart - (hunk.newLines === 0 ? 1 : 0),
    newCount: hunk.newLines,
    lines,
  };
};

export const buildDiff = ({
  file,
  previousPath,
  oldBytes,
  newBytes,
}: DiffSides): GitDiff => {
  if (oldBytes === null && newBytes === null) {
    throw new Error("Git diff file is absent on both sides");
  }
  const identity = {
    file,
    ...(previousPath === undefined ? {} : { previousPath }),
  };
  if (isBinary(oldBytes) || isBinary(newBytes)) {
    return {
      ...identity,
      binary: true,
      oldContent: null,
      newContent: null,
      hunks: [],
    };
  }
  const oldContent = oldBytes?.toString("utf8") ?? null;
  const newContent = newBytes?.toString("utf8") ?? null;
  // Keep CRLF and terminal-newline differences significant. Bound pathological
  // edit distances instead of allowing an open diff to monopolize the server.
  const patch = structuredPatch(
    file,
    file,
    oldContent ?? "",
    newContent ?? "",
    undefined,
    undefined,
    {
      context: 3,
      stripTrailingCr: false,
      maxEditLength: 20_000,
      timeout: 500,
    },
  );
  if (!patch) {
    throw new Error("Git text diff exceeded its computation limit");
  }
  const oldLines = lineTexts(oldContent ?? "");
  const newLines = lineTexts(newContent ?? "");
  return {
    ...identity,
    binary: false,
    oldContent,
    newContent,
    hunks: patch.hunks.map((hunk) => numberHunk(hunk, oldLines, newLines)),
  };
};
