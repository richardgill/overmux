import { z } from "zod";

// Example: "/home/me/code/app"
export const absolutePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) => path.startsWith("/") && !path.includes("\0"),
    "Expected an absolute path",
  );

// Example: "src/app.ts", relative to repoRoot.
export const gitFileSchema = z
  .string()
  .min(1)
  .refine(
    (file) =>
      !file.startsWith("/") &&
      !file.includes("\0") &&
      file
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            part.toLowerCase() !== ".git",
        ),
    "Expected a repository-relative file outside Git metadata",
  );

export const gitResourceOptionsSchema = z
  .object({
    allowedRoots: z.array(absolutePathSchema).min(1).readonly(),
  })
  .strict();

export const gitStatusInputSchema = z
  .object({ repoRoot: absolutePathSchema })
  .strict();

export const gitBranchSchema = z
  .object({
    // A detached HEAD has no name; an unborn branch retains its intended name.
    name: z.string().min(1).nullable(),
    upstream: z.string().min(1).nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    // True before the branch's first commit: it has a name, but HEAD points to no commit.
    unborn: z.boolean(),
  })
  .strict();

export const gitChangeSchema = z
  .object({
    path: gitFileSchema,
    previousPath: gitFileSchema.optional(),
    area: z.enum(["staged", "unstaged", "conflict"]),
    status: z.enum(["added", "modified", "deleted", "renamed", "untracked"]),
    binary: z.boolean(),
  })
  .strict();

export const gitStatusSchema = z
  .object({
    repoRoot: absolutePathSchema,
    branch: gitBranchSchema,
    changes: z.array(gitChangeSchema),
  })
  .strict();

// Unstaged: { base: { kind: "index" }, target: "workingTree" }
// Staged: { base: { kind: "commit", ref: "HEAD" }, target: "index" }
// Against a branch: { base: { kind: "commit", ref: "main" }, target: "workingTree" }
export const gitComparisonSchema = z
  .object({
    base: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("index") }).strict(),
      z
        .object({
          kind: z.literal("commit"),
          ref: z
            .string()
            .min(1)
            .refine((ref) => !ref.includes("\0")),
        })
        .strict(),
    ]),
    target: z.enum(["workingTree", "index"]),
  })
  .strict()
  .refine(
    ({ base, target }) => base.kind !== "index" || target === "workingTree",
    "Index-to-index comparison is unsupported",
  );
// Example: {
//   repoRoot: "/home/me/code/app", file: "src/app.ts",
//   comparison: { base: { kind: "index" }, target: "workingTree" },
// }
export const gitDiffInputSchema = z
  .object({
    repoRoot: absolutePathSchema,
    file: gitFileSchema,
    comparison: gitComparisonSchema,
  })
  .strict();
// Examples (text excludes the line terminator):
// { kind: "context", oldLine: 1, newLine: 1, text: "unchanged" }
// { kind: "removed", oldLine: 2, text: "before" }
// { kind: "added", newLine: 2, text: "after" }
export const gitDiffLineSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("context"),
      oldLine: z.number().int().positive(),
      newLine: z.number().int().positive(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("removed"),
      oldLine: z.number().int().positive(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("added"),
      newLine: z.number().int().positive(),
      text: z.string(),
    })
    .strict(),
]);
// Example of adding the first line to an empty file: {
//   oldStart: 0, oldCount: 0, newStart: 1, newCount: 1,
//   lines: [{ kind: "added", newLine: 1, text: "hello" }],
// }
export const gitDiffHunkSchema = z
  .object({
    oldStart: z.number().int().nonnegative(),
    oldCount: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newCount: z.number().int().nonnegative(),
    lines: z.array(gitDiffLineSchema),
  })
  .strict();
// Example of a new text file (null means absent; "" would mean an empty file): {
//   file: "hello.txt", binary: false, oldContent: null, newContent: "hello\n",
//   hunks: [{
//     oldStart: 0, oldCount: 0, newStart: 1, newCount: 1,
//     lines: [{ kind: "added", newLine: 1, text: "hello" }],
//   }],
// }
export const gitDiffSchema = z
  .object({
    file: gitFileSchema,
    previousPath: gitFileSchema.optional(),
    binary: z.boolean(),
    oldContent: z.string().nullable(),
    newContent: z.string().nullable(),
    hunks: z.array(gitDiffHunkSchema),
  })
  .strict();

export type GitResourceOptions = z.infer<typeof gitResourceOptionsSchema>;
export type GitStatusInput = z.infer<typeof gitStatusInputSchema>;
export type GitBranch = z.infer<typeof gitBranchSchema>;
export type GitChange = z.infer<typeof gitChangeSchema>;
export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitComparison = z.infer<typeof gitComparisonSchema>;
export type GitDiffInput = z.infer<typeof gitDiffInputSchema>;
export type GitDiffLine = z.infer<typeof gitDiffLineSchema>;
export type GitDiffHunk = z.infer<typeof gitDiffHunkSchema>;
export type GitDiff = z.infer<typeof gitDiffSchema>;
