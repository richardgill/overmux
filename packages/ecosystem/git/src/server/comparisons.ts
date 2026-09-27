// Resolves symbolic refs once and identifies immutable file versions with one rename pass per comparison.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gitFileSchema,
  type GitComparison,
  type GitFileChange,
} from "../shared";
import { GitCommandError, runGit } from "./execution";
import {
  assertFileOutsideMetadata,
  gitPath,
  type Repository,
} from "./repository";
import { readWorkingSummary } from "./contents";

export type ContentSource =
  | { kind: "blob"; gitObjectId: string }
  | { kind: "workingFile"; path: string }
  | { kind: "absent" };

export type FileComparison = {
  path: string;
  previousPath?: string;
  status?: GitFileChange["status"];
  binary: boolean;
  lineStats?: GitFileChange["lineStats"];
  old: ContentSource;
  new: ContentSource;
};

type Entry = { mode: string; gitObjectId: string; conflicted?: boolean };
type ReadOptions = { repository: Repository; signal: AbortSignal };

const absent: ContentSource = { kind: "absent" };
const source = (entry?: Entry): ContentSource =>
  !entry || entry.mode === "000000"
    ? absent
    : { kind: "blob", gitObjectId: entry.gitObjectId };

const unsupported = (entry?: Entry) =>
  entry?.mode === "160000" || entry?.mode === "040000";

const statusByCode: Record<string, GitFileChange["status"]> = {
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "renamed",
  U: "conflicted",
};

const resolveCommit = async ({
  repository,
  ref,
  signal,
}: ReadOptions & { ref: string }): Promise<string | null> => {
  try {
    return gitPath(
      await runGit(
        repository.repoRoot,
        ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
        { signal },
      ),
    );
  } catch (cause) {
    if (ref !== "HEAD" || !(cause instanceof GitCommandError)) {
      throw cause;
    }
    // Only an exact HEAD pointing to a genuinely absent branch is an empty base.
    // Misspelled refs, broken objects and detached HEAD errors remain errors.
    const branch = gitPath(
      await runGit(repository.repoRoot, ["symbolic-ref", "--quiet", "HEAD"], {
        signal,
      }),
    );
    try {
      await runGit(
        repository.repoRoot,
        ["show-ref", "--verify", "--quiet", branch],
        { signal },
      );
    } catch (missing) {
      if (missing instanceof GitCommandError && missing.status === 1) {
        return null;
      }
      throw missing;
    }
    throw cause;
  }
};

const resolveComparison = async ({
  repository,
  comparison,
  signal,
}: ReadOptions & { comparison: GitComparison }) => {
  const refs = [
    ...new Set([
      ...(comparison.base.kind === "mergeBase"
        ? comparison.base.refs
        : comparison.base.kind === "commit"
          ? [comparison.base.ref]
          : []),
      ...(comparison.target.kind === "commit" ? [comparison.target.ref] : []),
    ]),
  ];
  const commits = new Map(
    await Promise.all(
      refs.map(
        async (ref) =>
          [ref, await resolveCommit({ repository, ref, signal })] as const,
      ),
    ),
  );
  const targetCommit =
    comparison.target.kind === "commit"
      ? commits.get(comparison.target.ref)!
      : null;
  if (comparison.base.kind !== "mergeBase") {
    return {
      baseCommit:
        comparison.base.kind === "commit"
          ? commits.get(comparison.base.ref)!
          : null,
      targetCommit,
    };
  }
  const bases = comparison.base.refs.map((ref) => commits.get(ref)!);
  if (bases.some((commit) => commit === null)) {
    throw new Error("Git merge base requires two existing commits");
  }
  const baseCommit = gitPath(
    await runGit(repository.repoRoot, ["merge-base", ...(bases as string[])], {
      signal,
    }),
  );
  return { baseCommit, targetCommit };
};

const readIndex = async ({ repository, signal }: ReadOptions) => {
  const output = await runGit(
    repository.repoRoot,
    ["ls-files", "--stage", "-z"],
    { signal },
  );
  const entries = new Map<string, Entry>();
  for (const record of output.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(\d+) ([a-f0-9]+) ([0-3])\t(.*)$/s.exec(record);
    if (!match) {
      throw new Error("Invalid Git index entry");
    }
    entries.set(match[4]!, {
      mode: match[1]!,
      gitObjectId: match[2]!,
      conflicted: match[3] !== "0",
    });
  }
  return entries;
};

const treeEntry = async ({
  repository,
  commit,
  file,
  signal,
}: ReadOptions & { commit: string | null; file: string }): Promise<
  Entry | undefined
> => {
  if (commit === null) {
    return undefined;
  }
  const output = await runGit(
    repository.repoRoot,
    ["ls-tree", "-z", commit, "--", file],
    { signal },
  );
  const match = /^(\d+) \S+ ([a-f0-9]+)\t/.exec(output.toString("utf8"));
  return match ? { mode: match[1]!, gitObjectId: match[2]! } : undefined;
};

const parseComparisons = (
  output: Buffer,
  workingTree: boolean,
  includeStats: boolean,
): FileComparison[] => {
  const records = output.toString("utf8").split("\0");
  const files = new Map<string, FileComparison>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const raw = /^:(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])\d*$/.exec(
      record,
    );
    const stats = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(record);
    if (raw) {
      const renamed = raw[5] === "R" || raw[5] === "C";
      const previousPath = records[index + 1]!;
      const path = records[index + (renamed ? 2 : 1)]!;
      const oldEntry = { mode: raw[1]!, gitObjectId: raw[3]! };
      const newEntry = { mode: raw[2]!, gitObjectId: raw[4]! };
      const isUnsupported = unsupported(oldEntry) || unsupported(newEntry);
      files.set(path, {
        path,
        ...(renamed ? { previousPath } : {}),
        status: statusByCode[raw[5]!] ?? "modified",
        binary: isUnsupported,
        ...(includeStats ? { lineStats: null } : {}),
        old: source(oldEntry),
        new:
          workingTree && raw[2] !== "000000"
            ? { kind: "workingFile", path }
            : source(newEntry),
      });
      index += renamed ? 2 : 1;
    } else if (stats) {
      const path = stats[3] === "" ? records[index + 2]! : stats[3]!;
      const file = files.get(path);
      if (file) {
        file.binary = file.binary || stats[1] === "-";
        if (includeStats) {
          file.lineStats =
            file.binary || file.status === "conflicted"
              ? null
              : { added: Number(stats[1]), deleted: Number(stats[2]) };
        }
      }
      if (stats[3] === "") {
        index += 2;
      }
    }
  }
  return [...files.values()];
};

const readWorkingMetadata = async ({
  repository,
  baseCommit,
  args,
  index,
  signal,
}: ReadOptions & {
  baseCommit: string;
  args: string[];
  index: Map<string, Entry>;
}) => {
  // Git normally ignores working files removed from the real index. A private
  // index tracks the union of base/index paths so staged deletions recreated on
  // disk compare against the base, including exact cancellation. Never write the
  // user's index or objects; remove this ephemeral index even after cancellation.
  const directory = await mkdtemp(join(tmpdir(), "overmux-git-index-"));
  const gitIndexFile = join(directory, "index");
  try {
    await runGit(repository.repoRoot, ["read-tree", baseCommit], {
      signal,
      gitIndexFile,
    });
    const entries = [...index]
      .filter(([, entry]) => !entry.conflicted)
      .map(([path, entry]) => `${entry.mode} ${entry.gitObjectId}\t${path}\0`)
      .join("");
    if (entries) {
      await runGit(
        repository.repoRoot,
        ["update-index", "-z", "--index-info"],
        { signal, gitIndexFile, input: entries },
      );
    }
    const tracked = await runGit(repository.repoRoot, ["ls-files", "-z"], {
      signal,
      gitIndexFile,
    });
    const output = await runGit(repository.repoRoot, args, {
      signal,
      gitIndexFile,
    });
    return {
      output,
      trackedPaths: new Set(tracked.toString("utf8").split("\0")),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const readUntrackedComparisons = async ({
  repository,
  trackedPaths,
  includeStats,
  signal,
}: ReadOptions & {
  trackedPaths: Set<string>;
  includeStats: boolean;
}): Promise<FileComparison[]> => {
  const output = await runGit(
    repository.repoRoot,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { signal },
  );
  const paths = output
    .toString("utf8")
    .split("\0")
    .filter((path) => path && !trackedPaths.has(path));
  const files: FileComparison[] = [];
  for (const path of paths) {
    const directory = path.endsWith("/");
    const filePath = directory ? path.slice(0, -1) : path;
    const summary = directory
      ? { binary: true, ...(includeStats ? { lineStats: null } : {}) }
      : includeStats
        ? await readWorkingSummary({ repository, file: filePath, signal })
        : { binary: false };
    files.push({
      path: filePath,
      status: "untracked",
      ...summary,
      old: absent,
      new: { kind: "workingFile", path: filePath },
    });
  }
  return files;
};

const includeConflicts = (
  files: FileComparison[],
  index: Map<string, Entry>,
  includeStats: boolean,
) => {
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const [path, entry] of index) {
    if (entry.conflicted) {
      byPath.set(path, {
        ...(byPath.get(path) ?? {
          path,
          binary: false,
          old: absent,
          new: absent,
        }),
        status: "conflicted",
        ...(includeStats ? { lineStats: null } : {}),
      });
    }
  }
  return [...byPath.values()];
};

export const readFileComparisons = async ({
  repository,
  comparison,
  file,
  includeStats,
  signal,
}: ReadOptions & {
  comparison: GitComparison;
  file?: string;
  includeStats: boolean;
}): Promise<FileComparison[]> => {
  if (file !== undefined) {
    gitFileSchema.parse(file);
    assertFileOutsideMetadata(repository, join(repository.repoRoot, file));
  }

  const { baseCommit, targetCommit } = await resolveComparison({
    repository,
    comparison,
    signal,
  });
  const emptyTree = gitPath(
    await runGit(
      repository.repoRoot,
      ["hash-object", "-t", "tree", "--stdin"],
      { signal, input: "" },
    ),
  );

  const args =
    comparison.base.kind === "index" ? [] : [baseCommit ?? emptyTree];
  if (comparison.target.kind === "commit") {
    args.push(targetCommit ?? emptyTree);
  }

  const index =
    comparison.target.kind === "commit"
      ? new Map<string, Entry>()
      : await readIndex({ repository, signal });

  const diffArgs = [
    "diff",
    "--raw",
    ...(includeStats ? ["--numstat"] : []),
    "-z",
    "--no-abbrev",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames=50%",
    "--ignore-submodules=none",
    ...(comparison.target.kind === "index" ? ["--cached"] : []),
    ...args,
    "--",
  ];

  const { output, trackedPaths } =
    comparison.target.kind === "workingTree" && comparison.base.kind !== "index"
      ? await readWorkingMetadata({
          repository,
          baseCommit: baseCommit ?? emptyTree,
          args: diffArgs,
          index,
          signal,
        })
      : {
          output: await runGit(repository.repoRoot, diffArgs, { signal }),
          trackedPaths: new Set(index.keys()),
        };

  const files = includeConflicts(
    parseComparisons(
      output,
      comparison.target.kind === "workingTree",
      includeStats,
    ),
    index,
    includeStats,
  );

  if (comparison.target.kind === "workingTree" && file === undefined) {
    const tracked = new Set([
      ...trackedPaths,
      ...files.map((entry) => entry.path),
    ]);
    files.push(
      ...(await readUntrackedComparisons({
        repository,
        trackedPaths: tracked,
        includeStats,
        signal,
      })),
    );
  }

  if (file === undefined) {
    return files;
  }

  const selected = files.find((item) => item.path === file);
  if (selected) {
    return [selected];
  }

  const oldEntry =
    comparison.base.kind === "index"
      ? index.get(file)
      : await treeEntry({ repository, commit: baseCommit, file, signal });

  const newEntry =
    comparison.target.kind === "commit"
      ? await treeEntry({ repository, commit: targetCommit, file, signal })
      : index.get(file);

  const renamedAway = files.some((entry) => entry.previousPath === file);
  return [
    {
      path: file,
      ...(renamedAway ||
      (oldEntry && !newEntry && comparison.target.kind !== "workingTree")
        ? { status: "deleted" as const }
        : !oldEntry && comparison.target.kind === "workingTree"
          ? { status: "untracked" as const }
          : {}),
      binary: unsupported(oldEntry) || unsupported(newEntry),
      old: source(oldEntry),
      new:
        comparison.target.kind === "workingTree"
          ? { kind: "workingFile", path: file }
          : source(newEntry),
    },
  ];
};
