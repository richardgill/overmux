// Environment-neutral contracts for independent named-change and selected-file resources.
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
    allowedRoots: z.array(absolutePathSchema).min(1).readonly().optional(),
  })
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
const refSchema = z
  .string()
  .min(1)
  .refine((ref) => !ref.includes("\0"));
const commitSchema = z
  .object({ kind: z.literal("commit"), ref: refSchema })
  .strict();
const indexSchema = z.object({ kind: z.literal("index") }).strict();
const workingTreeSchema = z.object({ kind: z.literal("workingTree") }).strict();
export const gitComparisonSchema = z.union([
  z.object({ base: indexSchema, target: workingTreeSchema }).strict(),
  z
    .object({
      base: z.union([
        commitSchema,
        z
          .object({
            kind: z.literal("mergeBase"),
            refs: z.tuple([refSchema, refSchema]).readonly(),
          })
          .strict(),
      ]),
      target: z.union([commitSchema, indexSchema, workingTreeSchema]),
    })
    .strict(),
]);
// Zod records discard __proto__. Validate through a Map so every caller label
// survives; Object.fromEntries creates safe own properties even for that name.
const namedRecordSchema = <Schema extends z.ZodType>(valueSchema: Schema) =>
  z
    .preprocess(
      (value: Record<string, z.infer<Schema>>) => {
        if (value === null || typeof value !== "object") {
          return null;
        }
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null
          ? new Map(Object.entries(value))
          : null;
      },
      z.map(z.string(), valueSchema),
    )
    .transform((entries) => Object.fromEntries(entries));

const contextLinesSchema = z.number().int().nonnegative();
export const gitChangesInputSchema = z
  .object({
    repoRoot: absolutePathSchema,
    comparisons: namedRecordSchema(gitComparisonSchema).refine(
      (value) => Object.keys(value).length > 0,
      "Expected at least one comparison",
    ),
    detailLevel: z.enum(["summary", "hunks", "full"]).optional(),
    contextLines: contextLinesSchema.optional(),
  })
  .strict();
export const gitDiffParamsSchema = z
  .object({
    repoRoot: absolutePathSchema,
    file: gitFileSchema,
    comparison: gitComparisonSchema,
    contextLines: contextLinesSchema.optional(),
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
export const gitHunkDiffSchema = z
  .object({
    hunks: z.array(gitDiffHunkSchema),
    oldContent: z.never().optional(),
    newContent: z.never().optional(),
  })
  .strict();
export const gitFullDiffSchema = gitHunkDiffSchema
  .extend({
    oldContent: z.string().nullable(),
    newContent: z.string().nullable(),
  })
  .strict();
// Example of a new text file (null means absent; "" would mean an empty file): {
//   file: "hello.txt", binary: false, oldContent: null, newContent: "hello\n",
//   hunks: [{
//     oldStart: 0, oldCount: 0, newStart: 1, newCount: 1,
//     lines: [{ kind: "added", newLine: 1, text: "hello" }],
//   }],
// }
export const gitDiffSchema = gitFullDiffSchema
  .extend({
    file: gitFileSchema,
    previousPath: gitFileSchema.optional(),
    binary: z.boolean(),
  })
  .strict();
export const gitFileChangeSchema = z
  .object({
    path: gitFileSchema,
    previousPath: gitFileSchema.optional(),
    status: z.enum([
      "added",
      "modified",
      "deleted",
      "renamed",
      "untracked",
      "conflicted",
    ]),
    binary: z.boolean(),
    lineStats: z
      .object({
        added: z.number().int().nonnegative(),
        deleted: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    diffParams: gitDiffParamsSchema,
    diff: z.union([gitHunkDiffSchema, gitFullDiffSchema]).optional(),
  })
  .strict();
export const gitChangesSchema = z
  .object({
    repoRoot: absolutePathSchema,
    branch: gitBranchSchema,
    comparisons: namedRecordSchema(z.array(gitFileChangeSchema)),
  })
  .strict();
export type GitResourceOptions = z.infer<typeof gitResourceOptionsSchema>;
export type GitBranch = z.infer<typeof gitBranchSchema>;
export type GitComparison = z.infer<typeof gitComparisonSchema>;
export type GitChangesInput = z.infer<typeof gitChangesInputSchema>;
export type GitChanges = z.infer<typeof gitChangesSchema>;
export type GitFileChange = z.infer<typeof gitFileChangeSchema>;
export type GitDiffParams = z.infer<typeof gitDiffParamsSchema>;
export type GitDiffLine = z.infer<typeof gitDiffLineSchema>;
export type GitDiffHunk = z.infer<typeof gitDiffHunkSchema>;
export type GitHunkDiff = z.infer<typeof gitHunkDiffSchema>;
export type GitFullDiff = z.infer<typeof gitFullDiffSchema>;
export type GitDiff = z.infer<typeof gitDiffSchema>;
