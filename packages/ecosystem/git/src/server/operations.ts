import { defineOperation } from "overmux";
import { z } from "zod";
import {
  gitApplyIndexPatchInputSchema,
  gitFilesInputSchema,
  gitOperationOptionsSchema,
  gitOperationResultSchema,
  type GitOperationOptions,
} from "../shared";
import { GitCommandError, runGit } from "./execution";
import {
  nulPaths,
  validateFileSelections,
  validatePatchPaths,
} from "./mutation-paths";
import { authorizeRepository, type Repository } from "./repository";

// Shared across factories, but only within this server process. External Git
// commands and filesystem edits are not serialized and there is no snapshot lock.
const mutationTails = new Map<string, Promise<void>>();

const serializeMutation = async (
  root: string,
  run: () => Promise<null>,
): Promise<null> => {
  const previous = mutationTails.get(root) ?? Promise.resolve();
  const pending = previous.then(run);
  // A failed/cancelled action must not poison the next action's turn.
  const tail = pending.then(
    () => undefined,
    () => undefined,
  );
  mutationTails.set(root, tail);
  try {
    return await pending;
  } finally {
    // Only the last queued action owns cleanup; older actions cannot erase it.
    if (mutationTails.get(root) === tail) {
      mutationTails.delete(root);
    }
  }
};

type MutationContext = { repository: Repository; signal: AbortSignal };
type Permission = keyof NonNullable<GitOperationOptions["permissions"]>;

const defineGitOperation = <Input extends z.ZodType<{ repoRoot: string }>>({
  input,
  permission,
  options,
  execute,
}: {
  input: Input;
  permission: Permission;
  options: GitOperationOptions;
  execute: (input: z.output<Input>, context: MutationContext) => Promise<void>;
}) =>
  defineOperation({
    input,
    output: gitOperationResultSchema,
    handle: async (rawInput, { signal }) => {
      if (options.permissions?.[permission] !== true) {
        throw new Error(
          `Git ${permission} is disabled; enable its permission explicitly`,
        );
      }
      const parsed = input.parse(rawInput);
      const repository = await authorizeRepository({
        repoRoot: parsed.repoRoot,
        allowedRoots: options.allowedRoots,
        signal,
      });
      return serializeMutation(repository.repoRoot, async () => {
        // Authorization and the queue wait can both outlive the requesting client.
        signal.throwIfAborted();
        await execute(parsed, { repository, signal });
        return null;
      });
    },
  });

const discardFiles = async (
  files: string[],
  { repository, signal }: MutationContext,
) => {
  const [status, index] = await Promise.all([
    runGit(
      repository.repoRoot,
      [
        "status",
        "--porcelain=v1",
        "-z",
        "--no-renames",
        "--untracked-files=all",
        "--",
        ...files,
      ],
      { signal },
    ),
    runGit(repository.repoRoot, ["ls-files", "--stage", "-z", "--", ...files], {
      signal,
    }),
  ]);
  const changes = new Map(
    nulPaths(status).map((entry) => [entry.slice(3), entry.slice(0, 2)]),
  );
  const indexed = nulPaths(index).map((entry) => ({
    file: entry.slice(entry.indexOf("\t") + 1),
    submodule: entry.startsWith("160000 "),
  }));
  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const file of files) {
    const state = changes.get(file);
    const entries = indexed.filter(
      (entry) => entry.file === file || entry.file.startsWith(`${file}/`),
    );
    if (
      state &&
      // Index: unchanged, added, modified, or type-changed. Working tree:
      // modified, deleted, or type-changed. Unmerged entries never qualify.
      /^[ MAT][MDT]$/.test(state) &&
      entries.length === 1 &&
      entries[0]?.file === file &&
      !entries[0].submodule
    ) {
      tracked.push(file);
    } else if (
      entries.length === 0 &&
      [...changes].some(
        ([path, code]) =>
          code === "??" && (path === file || path.startsWith(`${file}/`)),
      )
    ) {
      untracked.push(file);
    } else {
      throw new Error(
        `Cannot discard ${JSON.stringify(file)}: select an unstaged tracked file or nonignored untracked file/directory; resolve conflicts first`,
      );
    }
  }
  // Validate the whole batch before either process. A later process failure can
  // still leave partial work; this is deliberately not a rollback transaction.
  if (tracked.length > 0) {
    await runGit(
      repository.repoRoot,
      ["restore", "--worktree", "--", ...tracked],
      { signal },
    );
  }
  if (untracked.length > 0) {
    await runGit(repository.repoRoot, ["clean", "-fd", "--", ...untracked], {
      signal,
    });
  }
};

export const gitOperationHandlers = (rawOptions: GitOperationOptions) => {
  const options = gitOperationOptionsSchema.parse(rawOptions);
  return {
    stage: defineGitOperation({
      input: gitFilesInputSchema,
      permission: "stage",
      options,
      execute: async ({ files }, { repository, signal }) => {
        await validateFileSelections(repository, files, signal);
        await runGit(repository.repoRoot, ["add", "--", ...files], { signal });
      },
    }),
    unstage: defineGitOperation({
      input: gitFilesInputSchema,
      permission: "unstage",
      options,
      execute: async ({ files }, { repository, signal }) => {
        await validateFileSelections(repository, files, signal);
        // Recent Git versions reset an unborn HEAD to an empty tree. Require a
        // real commit explicitly rather than silently unstaging the initial index.
        await runGit(
          repository.repoRoot,
          ["rev-parse", "--verify", "HEAD^{commit}"],
          { signal },
        ).catch((error: unknown) => {
          if (error instanceof GitCommandError) {
            throw new Error(
              "Cannot unstage: HEAD must resolve to a commit; create the first commit first",
              { cause: error },
            );
          }
          throw error;
        });
        await runGit(repository.repoRoot, ["reset", "HEAD", "--", ...files], {
          signal,
        });
      },
    }),
    discard: defineGitOperation({
      input: gitFilesInputSchema,
      permission: "discard",
      options,
      execute: async ({ files }, context) => {
        await validateFileSelections(context.repository, files, context.signal);
        await discardFiles([...new Set(files)], context);
      },
    }),
    applyIndexPatch: defineGitOperation({
      input: gitApplyIndexPatchInputSchema,
      permission: "applyIndexPatch",
      options,
      execute: async ({ patch, reverse }, { repository, signal }) => {
        await validatePatchPaths(repository, patch, signal);
        await runGit(
          repository.repoRoot,
          [
            "apply",
            "--cached",
            "--unidiff-zero",
            ...(reverse ? ["--reverse"] : []),
          ],
          { signal, input: patch },
        );
      },
    }),
  };
};
