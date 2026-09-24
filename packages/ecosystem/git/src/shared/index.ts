import { z } from "zod";

export const absolutePathSchema = z
  .string()
  .min(1)
  .refine((path) => path.startsWith("/"), "Expected an absolute path");

export const gitComparisonSchema = z.enum(["uncommitted", "base"]);

export const gitChangeSchema = z
  .object({
    area: z.enum(["staged", "unstaged", "conflict"]).optional(),
    binary: z.boolean(),
    deletions: z.number().int().nonnegative(),
    insertions: z.number().int().nonnegative(),
    path: z.string().min(1),
    previousPath: z.string().min(1).optional(),
    status: z.enum(["added", "modified", "deleted", "renamed", "untracked"]),
  })
  .strict();

const gitUncommittedChangeSchema = gitChangeSchema.extend({
  area: z.enum(["staged", "unstaged", "conflict"]),
});

const gitBranchSchema = z
  .object({
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    name: z.string().min(1).optional(),
    upstream: z.string().min(1).optional(),
  })
  .strict();

export const gitSourceControlFileSchema = z
  .object({
    binary: z.boolean(),
    newContent: z.string().nullable(),
    oldContent: z.string().nullable(),
    patch: z.string(),
    path: z.string().min(1),
    previousPath: z.string().min(1).optional(),
  })
  .strict();

const sourceControlFields = {
  diffs: z.record(z.string(), gitSourceControlFileSchema),
  revision: z.string().min(1),
  root: absolutePathSchema,
};

export const gitSourceControlSchema = z.discriminatedUnion("comparison", [
  z
    .object({
      ...sourceControlFields,
      branch: gitBranchSchema,
      changes: z.array(gitUncommittedChangeSchema),
      comparison: z.literal("uncommitted"),
    })
    .strict(),
  z
    .object({
      ...sourceControlFields,
      base: z.string().min(1),
      changes: z.array(gitChangeSchema),
      comparison: z.literal("base"),
    })
    .strict(),
]);

export const gitSourceControlInputSchema = z
  .object({ comparison: gitComparisonSchema, path: absolutePathSchema })
  .strict();

const changeSelectionSchema = z.union([
  z.string().min(1),
  z
    .object({
      path: z.string().min(1),
      area: z.enum(["staged", "unstaged"]).optional(),
    })
    .strict(),
]);

export const gitMutationInputSchema = z
  .object({
    path: absolutePathSchema,
    changes: z.array(changeSelectionSchema).min(1),
    expectedRevision: z.string().min(1),
  })
  .strict();

export const gitApplyPatchInputSchema = z
  .object({
    path: absolutePathSchema,
    patch: z.string().min(1),
    expectedRevision: z.string().min(1),
  })
  .strict();

export const gitMutationResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("success"), revision: z.string().min(1) })
    .strict(),
  z
    .object({ outcome: z.literal("stale"), revision: z.string().min(1) })
    .strict(),
  z
    .object({ outcome: z.literal("error"), message: z.string().min(1) })
    .strict(),
]);

export type GitChange = z.infer<typeof gitChangeSchema>;
export type GitSourceControl = z.infer<typeof gitSourceControlSchema>;
export type GitSourceControlFile = z.infer<typeof gitSourceControlFileSchema>;
export type GitMutationResult = z.infer<typeof gitMutationResultSchema>;

export const gitChangeKey = (change: Pick<GitChange, "area" | "path">) =>
  `${change.area ?? "base"}:${change.path}`;
