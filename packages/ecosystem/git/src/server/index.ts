import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import type {
  OperationContext,
  OperationDefinition,
  HandlerContext,
  SubscriptionResourceDefinition,
} from "overmux";
import { z } from "zod";

import { GitCommandError, runGit } from "./git-execution";
import { type GitRepositoryWatcher, watchGitRepository } from "./git-watch";
import { untrackedStats } from "./git-worktree";
import { parseGitStatus, type ParsedStatusChange } from "./parse-git-status";
import {
  gitApplyPatchInputSchema,
  gitChangeKey,
  gitMutationInputSchema,
  gitSourceControlInputSchema,
  gitSourceControlSchema,
  gitMutationResultSchema,
  type GitChange,
  type GitSourceControl,
  type GitSourceControlFile,
  type GitMutationResult,
} from "../shared";

type GitPermissions = {
  applyPatch?: boolean;
  discard?: boolean;
  stage?: boolean;
  unstage?: boolean;
};
export type GitBaseResolver = (options: {
  root: string;
  signal?: AbortSignal;
}) => Promise<string>;
type GitRepositoriesOptions = {
  allowedRoots: readonly [string, ...string[]];
  baseResolver?: GitBaseResolver;
  permissions?: GitPermissions;
  watch?: { debounceMs?: number };
};
type GitRepositories = {
  baseResolver: GitBaseResolver;
  permissions: Required<GitPermissions>;
  resolve: (path: string, signal?: AbortSignal) => Promise<GitRepository>;
  watchDebounceMs: number;
};
type GitChangeSummary =
  | Omit<Extract<GitSourceControl, { comparison: "uncommitted" }>, "diffs">
  | Omit<Extract<GitSourceControl, { comparison: "base" }>, "diffs">;
type PatchInput =
  | { change: GitChange; comparison: "uncommitted" }
  | { base: string; change: GitChange; comparison: "base" };
type GitRepository = {
  sourceControl: (
    comparison: "uncommitted" | "base",
    signal?: AbortSignal,
  ) => Promise<GitSourceControl>;
  mutate: (
    operation: keyof GitPermissions,
    input: z.input<typeof gitMutationInputSchema>,
    signal?: AbortSignal,
  ) => Promise<GitMutationResult>;
  applyPatch: (
    input: z.input<typeof gitApplyPatchInputSchema>,
    signal?: AbortSignal,
  ) => Promise<GitMutationResult>;
  subscribe: (listener: () => void) => () => void;
};

const statusName = (change: ParsedStatusChange): GitChange["status"] =>
  change.code === "A"
    ? "added"
    : change.code === "D"
      ? "deleted"
      : change.code === "R" || change.code === "C"
        ? "renamed"
        : change.code === "?"
          ? "untracked"
          : "modified";
const inside = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};
const statusArgs = [
  "status",
  "--porcelain=v2",
  "-z",
  "--branch",
  "--untracked-files=all",
];

const revisionFor = async (
  root: string,
  signal?: AbortSignal,
  statusOutput?: Awaited<ReturnType<typeof runGit>>,
) => {
  const status = statusOutput ?? (await runGit(root, statusArgs, { signal }));
  const untrackedPaths = parseGitStatus(status.stdout).changes.flatMap(
    (change) => (change.code === "?" ? [change.path] : []),
  );
  const outputs = await Promise.all([
    status,
    runGit(root, ["diff", "--cached", "--binary", "--no-ext-diff", "--"], {
      signal,
    }),
    runGit(root, ["diff", "--binary", "--no-ext-diff", "--"], { signal }),
    ...untrackedPaths.map((path) =>
      runGit(root, ["hash-object", "--", path], { signal }),
    ),
  ]);
  return createHash("sha256")
    .update(Buffer.concat(outputs.map(({ stdout }) => stdout)))
    .digest("hex");
};

const statsFor = (output: Buffer) => {
  const records = output.toString("utf8").split("\0");
  const stats = new Map<
    string,
    { binary: boolean; deletions: number; insertions: number }
  >();
  for (let index = 0; index < records.length; index += 1) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(records[index] ?? "");
    if (match) {
      const path = match[3] || records[index + 2];
      if (path) {
        const binary = match[1] === "-" || match[2] === "-";
        stats.set(path, {
          binary,
          deletions: binary ? 0 : Number(match[2]),
          insertions: binary ? 0 : Number(match[1]),
        });
      }
      if (!match[3]) {
        index += 2;
      }
    }
  }
  return stats;
};

const changeFromStatus = async (
  root: string,
  change: ParsedStatusChange,
  stats: Map<
    string,
    { binary: boolean; deletions: number; insertions: number }
  >,
  signal?: AbortSignal,
): Promise<GitChange> => {
  const untracked = change.code === "?";
  const fileStats = untracked
    ? await untrackedStats(root, change.path, 2_000_000)
    : (stats.get(change.path) ?? {
        binary: false,
        deletions: 0,
        insertions: 0,
      });
  return {
    area: change.area,
    binary: change.trackedSubmodule || fileStats.binary,
    deletions: fileStats.deletions ?? 0,
    insertions: fileStats.insertions ?? 0,
    path: change.path,
    ...(change.previousPath ? { previousPath: change.previousPath } : {}),
    status: statusName(change),
  };
};

const uncommittedChanges = async (
  root: string,
  signal?: AbortSignal,
): Promise<Extract<GitChangeSummary, { comparison: "uncommitted" }>> => {
  const [statusOutput, staged, unstaged] = await Promise.all([
    runGit(root, statusArgs, { signal }),
    runGit(root, ["diff", "--cached", "--numstat", "-z", "--"], { signal }),
    runGit(root, ["diff", "--numstat", "-z", "--"], { signal }),
  ]);
  const parsed = parseGitStatus(statusOutput.stdout);
  const changes = await Promise.all(
    parsed.changes.map((change) =>
      changeFromStatus(
        root,
        change,
        change.area === "staged"
          ? statsFor(staged.stdout)
          : statsFor(unstaged.stdout),
        signal,
      ),
    ),
  );
  return {
    branch: {
      ahead: parsed.branch.ahead ?? 0,
      behind: parsed.branch.behind ?? 0,
      ...(parsed.branch.head ? { name: parsed.branch.head } : {}),
      ...(parsed.branch.upstream ? { upstream: parsed.branch.upstream } : {}),
    },
    changes: changes as Extract<
      GitChangeSummary,
      { comparison: "uncommitted" }
    >["changes"],
    comparison: "uncommitted",
    revision: await revisionFor(root, signal, statusOutput),
    root,
  };
};

const baseChangeStatus = (code: string): GitChange["status"] =>
  code.startsWith("A")
    ? "added"
    : code.startsWith("D")
      ? "deleted"
      : code.startsWith("R") || code.startsWith("C")
        ? "renamed"
        : "modified";

const trackedChangesFromDiff = (statsOutput: Buffer, namesOutput: Buffer) => {
  const stats = statsFor(statsOutput);
  const records = namesOutput.toString("utf8").split("\0").filter(Boolean);
  const changes: GitChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const code = records[index] ?? "M";
    const renamed = code.startsWith("R") || code.startsWith("C");
    const previousPath = renamed ? records[index + 1] : undefined;
    const path = records[index + (renamed ? 2 : 1)];
    if (path) {
      changes.push({
        ...(stats.get(path) ?? {
          binary: false,
          deletions: 0,
          insertions: 0,
        }),
        path,
        ...(previousPath ? { previousPath } : {}),
        status: baseChangeStatus(code),
      });
      index += renamed ? 2 : 1;
    }
  }
  return changes;
};

const baseUntrackedChanges = async (
  root: string,
  statusOutput: Buffer,
  tracked: GitChange[],
  signal?: AbortSignal,
) => {
  const trackedPaths = new Set(tracked.map(({ path }) => path));
  const paths = parseGitStatus(statusOutput).changes.flatMap((change) =>
    change.code === "?" && !trackedPaths.has(change.path) ? [change.path] : [],
  );
  const [changes, hashes] = await Promise.all([
    Promise.all(
      paths.map(async (path): Promise<GitChange> => {
        const stat = await untrackedStats(root, path, 2_000_000);
        return {
          binary: stat.binary,
          deletions: stat.deletions ?? 0,
          insertions: stat.insertions ?? 0,
          path,
          status: "untracked",
        };
      }),
    ),
    Promise.all(
      paths.map((path) =>
        runGit(root, ["hash-object", "--", path], { signal }),
      ),
    ),
  ]);
  return {
    changes,
    hashes: Buffer.concat(hashes.map(({ stdout }) => stdout)),
  };
};

const baseChanges = async (
  root: string,
  base: string,
  signal?: AbortSignal,
): Promise<GitChangeSummary> => {
  const [stats, names, patch, status] = await Promise.all([
    runGit(root, ["diff", "--numstat", "-z", "--find-renames", base, "--"], {
      signal,
    }),
    runGit(
      root,
      ["diff", "--name-status", "-z", "--find-renames", base, "--"],
      { signal },
    ),
    runGit(root, ["diff", "--binary", "--no-ext-diff", base, "--"], {
      signal,
    }),
    runGit(root, statusArgs, { signal }),
  ]);
  const tracked = trackedChangesFromDiff(stats.stdout, names.stdout);
  const untracked = await baseUntrackedChanges(
    root,
    status.stdout,
    tracked,
    signal,
  );
  const revision = createHash("sha256")
    .update(base)
    .update(patch.stdout)
    .update(untracked.hashes)
    .digest("hex");
  return {
    base,
    changes: [...tracked, ...untracked.changes],
    comparison: "base",
    revision,
    root,
  };
};

const operationPaths = (
  operation: keyof GitPermissions,
  changes: z.output<typeof gitMutationInputSchema>["changes"],
  status: Extract<GitChangeSummary, { comparison: "uncommitted" }>,
) => {
  const paths = [
    ...new Set(
      changes.map((change) =>
        typeof change === "string" ? change : change.path,
      ),
    ),
  ];
  if (
    paths.some(
      (path) => isAbsolute(path) || path === ".." || path.startsWith("../"),
    )
  ) {
    throw new Error("Git change paths must stay within the repository");
  }
  const selected = status.changes.filter((change) =>
    changes.some((selection) => {
      const path = typeof selection === "string" ? selection : selection.path;
      const area = typeof selection === "string" ? undefined : selection.area;
      return (
        change.path === path && (area === undefined || change.area === area)
      );
    }),
  );
  if (
    changes.some((selection) => {
      const path = typeof selection === "string" ? selection : selection.path;
      const area = typeof selection === "string" ? undefined : selection.area;
      return !selected.some(
        (change) =>
          change.path === path && (area === undefined || change.area === area),
      );
    })
  ) {
    throw new Error("Git change is not available at the expected revision");
  }
  if (
    (operation === "stage" && selected.some(({ area }) => area === "staged")) ||
    (operation === "unstage" &&
      selected.some(({ area }) => area !== "staged")) ||
    (operation === "discard" && selected.some(({ area }) => area === "staged"))
  ) {
    throw new Error(`Git changes cannot be used for ${operation}`);
  }
  return paths;
};
const mutation = async ({
  execute,
  expectedRevision,
  root,
  signal,
}: {
  execute: () => Promise<void>;
  expectedRevision: string;
  root: string;
  signal?: AbortSignal;
}): Promise<GitMutationResult> => {
  try {
    const revision = await revisionFor(root, signal);
    if (revision !== expectedRevision) {
      return { outcome: "stale", revision };
    }
    await execute();
    return { outcome: "success", revision: await revisionFor(root, signal) };
  } catch (cause) {
    return {
      outcome: "error",
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
};
const defaultBaseResolver: GitBaseResolver = async ({ root, signal }) =>
  runGit(root, ["merge-base", "HEAD", "@{upstream}"], { signal })
    .then(({ stdout }) => stdout.toString("utf8").trim())
    .catch(async () =>
      (await runGit(root, ["merge-base", "HEAD", "main"], { signal })).stdout
        .toString("utf8")
        .trim(),
    );

const patchFor = async (
  root: string,
  input: PatchInput,
  signal?: AbortSignal,
) => {
  const { change } = input;
  const paths = change.previousPath
    ? [change.previousPath, change.path]
    : [change.path];
  const args =
    change.status === "untracked"
      ? [
          "diff",
          "--no-index",
          "--no-ext-diff",
          "--binary",
          "--",
          "/dev/null",
          change.path,
        ]
      : input.comparison === "base"
        ? ["diff", "--binary", "--no-ext-diff", input.base, "--", ...paths]
        : change.area === "staged"
          ? [
              "diff",
              "--cached",
              "--binary",
              "--no-ext-diff",
              "HEAD",
              "--",
              ...paths,
            ]
          : ["diff", "--binary", "--no-ext-diff", "--", ...paths];
  const output = await runGit(root, args, {
    acceptedExitCodes: change.status === "untracked" ? [0, 1] : undefined,
    signal,
  });
  return {
    patch: output.stdout.toString("utf8"),
    path: change.path,
    ...(change.previousPath ? { previousPath: change.previousPath } : {}),
  };
};

type FileContentSource =
  | { kind: "git"; optional?: boolean; spec: string }
  | { kind: "worktree"; optional?: boolean; path: string }
  | null;

const contentSources = (
  changes: GitChangeSummary,
  change: GitChange,
): { newSource: FileContentSource; oldSource: FileContentSource } => {
  if (changes.comparison === "base") {
    return {
      newSource:
        change.status === "deleted"
          ? null
          : { kind: "worktree", path: change.path },
      oldSource:
        change.status === "added" || change.status === "untracked"
          ? null
          : {
              kind: "git",
              spec: `${changes.base}:${change.previousPath ?? change.path}`,
            },
    };
  }
  if (change.area === "staged") {
    return {
      newSource:
        change.status === "deleted"
          ? null
          : { kind: "git", spec: `:${change.path}` },
      oldSource:
        change.status === "added"
          ? null
          : {
              kind: "git",
              spec: `HEAD:${change.previousPath ?? change.path}`,
            },
    };
  }
  if (change.area === "conflict") {
    return {
      newSource: { kind: "worktree", optional: true, path: change.path },
      oldSource: { kind: "git", optional: true, spec: `:2:${change.path}` },
    };
  }
  return {
    newSource:
      change.status === "deleted"
        ? null
        : { kind: "worktree", path: change.path },
    oldSource:
      change.status === "untracked"
        ? null
        : {
            kind: "git",
            spec: `:${change.previousPath ?? change.path}`,
          },
  };
};

const readWorktreeContent = async (
  root: string,
  source: Extract<FileContentSource, { kind: "worktree" }>,
  signal?: AbortSignal,
) => {
  try {
    signal?.throwIfAborted();
    const path = join(root, source.path);
    const metadata = await lstat(path);
    const contents = metadata.isSymbolicLink()
      ? Buffer.from(await readlink(path))
      : await readFile(path, { signal });
    if (contents.byteLength > 16_000_000) {
      throw new Error("Git file content exceeded 16000000 bytes");
    }
    return contents.toString("utf8");
  } catch (cause) {
    signal?.throwIfAborted();
    if (source.optional) {
      return null;
    }
    throw cause;
  }
};

const readFileContent = async (
  root: string,
  source: FileContentSource,
  signal?: AbortSignal,
) => {
  if (!source) {
    return null;
  }
  if (source.kind === "worktree") {
    return readWorktreeContent(root, source, signal);
  }
  try {
    return (
      await runGit(root, ["cat-file", "blob", source.spec], { signal })
    ).stdout.toString("utf8");
  } catch (cause) {
    signal?.throwIfAborted();
    if (source.optional && cause instanceof GitCommandError) {
      return null;
    }
    throw cause;
  }
};

const contentsFor = async (
  root: string,
  changes: GitChangeSummary,
  change: GitChange,
  signal?: AbortSignal,
) => {
  const { newSource, oldSource } = contentSources(changes, change);
  const [oldContent, newContent] = await Promise.all([
    readFileContent(root, oldSource, signal),
    readFileContent(root, newSource, signal),
  ]);
  return { newContent, oldContent };
};

const repositoryChanges = async (
  root: string,
  repositories: Pick<GitRepositories, "baseResolver">,
  comparison: "uncommitted" | "base",
  signal?: AbortSignal,
) => {
  if (comparison === "uncommitted") {
    return uncommittedChanges(root, signal);
  }
  const candidate = await repositories.baseResolver({ root, signal });
  const base = await runGit(
    root,
    ["rev-parse", "--verify", `${candidate}^{commit}`],
    { signal },
  ).then(({ stdout }) => stdout.toString("utf8").trim());
  return baseChanges(root, base, signal);
};

const safeChangePaths = (change: GitChange) => {
  const paths = [change.path, change.previousPath].filter(
    (path): path is string => Boolean(path),
  );
  if (
    paths.some(
      (path) =>
        isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`),
    )
  ) {
    throw new Error("Git change is not available at the expected revision");
  }
};

const snapshotDiffs = async (
  root: string,
  changes: GitChangeSummary,
  signal?: AbortSignal,
) => {
  const buckets = Array.from({ length: 4 }, (_, bucketIndex) =>
    changes.changes.filter((_, index) => index % 4 === bucketIndex),
  );
  const entries = await Promise.all(
    buckets.map(async (bucket) => {
      const files: [string, GitSourceControlFile][] = [];
      for (const change of bucket) {
        safeChangePaths(change);
        const file = change.binary
          ? {
              binary: true,
              newContent: null,
              oldContent: null,
              patch: "",
              path: change.path,
              ...(change.previousPath
                ? { previousPath: change.previousPath }
                : {}),
            }
          : await Promise.all([
              patchFor(
                root,
                changes.comparison === "base"
                  ? { base: changes.base, change, comparison: "base" }
                  : { change, comparison: "uncommitted" },
                signal,
              ),
              contentsFor(root, changes, change, signal),
            ]).then(([patch, contents]) => ({
              binary: false,
              ...contents,
              ...patch,
            }));
        files.push([gitChangeKey(change), file]);
      }
      return files;
    }),
  );
  return Object.fromEntries(entries.flat());
};

const sourceControlSnapshot = async (
  root: string,
  repositories: Pick<GitRepositories, "baseResolver">,
  comparison: "uncommitted" | "base",
  signal?: AbortSignal,
  attempts = 2,
): Promise<GitSourceControl> => {
  const changes = await repositoryChanges(
    root,
    repositories,
    comparison,
    signal,
  );
  const diffs = await snapshotDiffs(root, changes, signal);
  const verified = await repositoryChanges(
    root,
    repositories,
    comparison,
    signal,
  );
  if (changes.revision === verified.revision) {
    return gitSourceControlSchema.parse({ ...changes, diffs });
  }
  if (attempts > 1) {
    return sourceControlSnapshot(
      root,
      repositories,
      comparison,
      signal,
      attempts - 1,
    );
  }
  throw new Error("Git repository changed while building source control data");
};

const createRepository = (
  root: string,
  repositories: Pick<
    GitRepositories,
    "baseResolver" | "permissions" | "watchDebounceMs"
  >,
): GitRepository => {
  const listeners = new Set<() => void>();
  let repositoryWatcher: GitRepositoryWatcher | undefined;
  let startingWatch = false;
  const publish = () => listeners.forEach((listener) => listener());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!repositoryWatcher && !startingWatch) {
      startingWatch = true;
      void watchGitRepository({
        debounceMs: repositories.watchDebounceMs,
        invalidate: publish,
        root,
      })
        .then(async (watcher) => {
          startingWatch = false;
          if (listeners.size === 0) {
            watcher.dispose();
            return;
          }
          repositoryWatcher = watcher;
          publish();
        })
        .catch(() => {
          startingWatch = false;
          publish();
        });
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        repositoryWatcher?.dispose();
        repositoryWatcher = undefined;
      }
    };
  };
  return {
    subscribe,
    sourceControl: async (comparison, signal) => {
      const snapshot = await sourceControlSnapshot(
        root,
        repositories,
        comparison,
        signal,
      );
      return snapshot;
    },
    mutate: (operation, input, signal) => {
      if (!repositories.permissions[operation]) {
        return Promise.resolve({
          outcome: "error",
          message: `Git ${operation} is not authorized`,
        });
      }
      return mutation({
        expectedRevision: input.expectedRevision,
        root,
        signal,
        execute: async () => {
          const status = await uncommittedChanges(root, signal);
          const paths = operationPaths(operation, input.changes, status);
          if (operation === "discard") {
            const untracked = status.changes
              .filter(
                (change) =>
                  change.status === "untracked" && paths.includes(change.path),
              )
              .map((change) => change.path);
            const tracked = paths.filter((path) => !untracked.includes(path));
            if (tracked.length) {
              await runGit(root, ["restore", "--worktree", "--", ...tracked], {
                signal,
              });
            }
            if (untracked.length) {
              await runGit(root, ["clean", "-f", "--", ...untracked], {
                signal,
              });
            }
          } else {
            await runGit(
              root,
              operation === "stage"
                ? ["add", "-A", "--", ...paths]
                : ["restore", "--staged", "--", ...paths],
              { signal },
            );
          }
          publish();
        },
      });
    },
    applyPatch: (input, signal) =>
      !repositories.permissions.applyPatch
        ? Promise.resolve({
            outcome: "error",
            message: "Git applyPatch is not authorized",
          })
        : mutation({
            expectedRevision: input.expectedRevision,
            root,
            signal,
            execute: async () => {
              await runGit(root, ["apply", "--cached", "--whitespace=nowarn"], {
                input: input.patch,
                signal,
              });
              publish();
            },
          }),
  };
};

export const defineGitRepositories = (
  options: GitRepositoriesOptions,
): GitRepositories => {
  if (options.allowedRoots.some((root) => !isAbsolute(root))) {
    throw new Error("Git allowedRoots must be absolute");
  }
  const baseResolver = options.baseResolver ?? defaultBaseResolver;
  const permissions = {
    applyPatch: false,
    discard: false,
    stage: false,
    unstage: false,
    ...options.permissions,
  };
  const watchDebounceMs = options.watch?.debounceMs ?? 75;
  const cache = new Map<string, GitRepository>();
  return {
    baseResolver,
    permissions,
    watchDebounceMs,
    resolve: async (path, signal) => {
      const canonicalPath = await realpath(path);
      const candidate = (await stat(canonicalPath)).isDirectory()
        ? canonicalPath
        : dirname(canonicalPath);
      const allowedRoots = await Promise.all(
        options.allowedRoots.map((root) => realpath(root)),
      );
      if (!allowedRoots.some((allowedRoot) => inside(allowedRoot, candidate))) {
        throw new Error("Git path is not authorized");
      }
      const root = await realpath(
        (
          await runGit(candidate, ["rev-parse", "--show-toplevel"], { signal })
        ).stdout
          .toString("utf8")
          .trim(),
      );
      if (!allowedRoots.some((allowedRoot) => inside(allowedRoot, root))) {
        throw new Error("Git repository is not authorized");
      }
      const existing = cache.get(root);
      if (existing) {
        return existing;
      }
      const repository = createRepository(root, {
        baseResolver,
        permissions,
        watchDebounceMs,
      });
      cache.set(root, repository);
      return repository;
    },
  };
};

export const gitSourceControlContract = {
  input: gitSourceControlInputSchema,
  output: gitSourceControlSchema,
};
type GitResourceInputs<TId extends string> = Record<
  TId,
  z.input<typeof gitSourceControlInputSchema>
>;

const invalidateGit = <TId extends string>({
  context,
  path,
  resourceId,
  result,
}: {
  context: HandlerContext<GitResourceInputs<TId>>;
  path: string;
  resourceId: TId;
  result: GitMutationResult;
}) => {
  if (result.outcome === "success") {
    context.invalidate(resourceId, {
      comparison: "uncommitted",
      path,
    });
  }
  return result;
};
export const gitSourceControlResource = ({
  repositories,
}: {
  repositories: GitRepositories;
}): SubscriptionResourceDefinition<
  typeof gitSourceControlInputSchema,
  typeof gitSourceControlSchema
> => ({
  contract: gitSourceControlContract,
  kind: "subscription",
  read: async ({ comparison, path }, context) =>
    (await repositories.resolve(path, context.signal)).sourceControl(
      comparison,
      context.signal,
    ),
  subscribe: ({ path }, invalidate, context) => {
    let disposed = false;
    let dispose: () => void = () => undefined;
    void repositories
      .resolve(path, context.signal)
      .then((repository) => {
        if (!disposed) {
          dispose = repository.subscribe(invalidate);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      dispose();
    };
  },
});
type GitOperationOptions<TId extends string> = {
  repositories: GitRepositories;
  resourceId: TId;
};

const operation = <const TId extends string>(
  permission: keyof GitPermissions,
  { repositories, resourceId }: GitOperationOptions<TId>,
): OperationDefinition<
  typeof gitMutationInputSchema,
  typeof gitMutationResultSchema,
  OperationContext<GitResourceInputs<TId>>
> => ({
  handle: async (input, context) => {
    const repository = await repositories.resolve(input.path, context.signal);
    const result = await repository.mutate(permission, input, context.signal);
    return invalidateGit({ context, path: input.path, resourceId, result });
  },
  input: gitMutationInputSchema,
  output: gitMutationResultSchema,
});
export const gitOperationHandlers = <const TId extends string>(
  options: GitOperationOptions<TId>,
) => {
  const { repositories, resourceId } = options;
  return {
    stage: operation("stage", options),
    unstage: operation("unstage", options),
    discard: operation("discard", options),
    applyPatch: {
      handle: async (
        input: z.output<typeof gitApplyPatchInputSchema>,
        context: OperationContext<GitResourceInputs<TId>>,
      ) => {
        const repository = await repositories.resolve(
          input.path,
          context.signal,
        );
        const result = await repository.applyPatch(input, context.signal);
        return invalidateGit({ context, path: input.path, resourceId, result });
      },
      input: gitApplyPatchInputSchema,
      output: gitMutationResultSchema,
    } satisfies OperationDefinition<
      typeof gitApplyPatchInputSchema,
      typeof gitMutationResultSchema,
      OperationContext<GitResourceInputs<TId>>
    >,
  };
};
export type { GitRepositoriesOptions, GitPermissions, GitRepositories };
