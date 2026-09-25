// Authorizes canonical repository roots and captures Git metadata or selected file bytes.
// Git owns rename detection; immutable object IDs anchor reads without claiming an atomic repository snapshot.
import { constants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import {
  gitFileSchema,
  type GitChange,
  type GitComparison,
  type GitResourceOptions,
  type GitStatus,
} from "../shared";
import type { DiffSides } from "./diff";
import { GitCommandError, MAX_CONTENT_BYTES, runGit } from "./execution";
import { parseGitStatus, type ParsedStatusChange } from "./parse-git-status";

export type Repository = {
  repoRoot: string;
  gitDir: string;
  commonDir: string;
};
type ReadOptions = { repository: Repository; signal?: AbortSignal };
type GitEntry = { mode: string; oid: string };
type RawChange = {
  path: string;
  previousPath?: string;
  code: string;
  old: GitEntry;
  next: GitEntry;
};

export const isWithin = (root: string, candidate: string) => {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
};
const gitPath = (output: Buffer) => output.toString("utf8").replace(/\n$/, "");
const isMissing = (cause: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((cause as NodeJS.ErrnoException)?.code ?? "");

export const authorizeRepository = async ({
  repoRoot,
  allowedRoots,
  signal,
}: GitResourceOptions & {
  repoRoot: string;
  signal?: AbortSignal;
}): Promise<Repository> => {
  signal?.throwIfAborted();
  if (!isAbsolute(repoRoot)) {
    throw new Error("Git repoRoot must be absolute");
  }
  const [candidate, roots] = await Promise.all([
    realpath(repoRoot),
    Promise.all(allowedRoots.map((root) => realpath(root))),
  ]);
  if (!roots.some((root) => isWithin(root, candidate))) {
    throw new Error("Git repository is not authorized");
  }
  // Discovery only happens after authorization. A nested directory is not a root,
  // even when Git would happily search its ancestors for a repository.
  const actual = await realpath(
    gitPath(
      await runGit(candidate, ["rev-parse", "--show-toplevel"], { signal }),
    ),
  );
  if (actual !== candidate) {
    throw new Error(
      "Git repoRoot must be the repository root, not a child directory",
    );
  }
  const [gitDir, commonDir] = await Promise.all([
    runGit(candidate, ["rev-parse", "--absolute-git-dir"], { signal }).then(
      async (path) => realpath(gitPath(path)),
    ),
    runGit(
      candidate,
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { signal },
    ).then(async (path) => realpath(gitPath(path))),
  ]);
  signal?.throwIfAborted();
  return { repoRoot: candidate, gitDir, commonDir };
};

const assertFileOutsideMetadata = (repository: Repository, path: string) => {
  if (
    !isWithin(repository.repoRoot, path) ||
    [repository.gitDir, repository.commonDir].some((root) =>
      isWithin(root, path),
    )
  ) {
    throw new Error(
      "Git file must stay inside the working tree and outside Git metadata",
    );
  }
};

const readWorkingFile = async ({
  repository,
  file,
  signal,
  sampleBytes,
}: ReadOptions & {
  file: string;
  sampleBytes?: number;
}): Promise<Buffer | null> => {
  gitFileSchema.parse(file);
  const path = join(repository.repoRoot, file);
  assertFileOutsideMetadata(repository, path);
  try {
    // Reject directory symlinks, including links back into the tree: their Git path
    // names the link, not its descendants. A final symlink is read as target text.
    const parent = dirname(path);
    if ((await realpath(parent)) !== parent) {
      throw new Error("Git file cannot traverse a symlink directory");
    }
    signal?.throwIfAborted();
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      return await readlink(path, { encoding: "buffer" });
    }
    if (!metadata.isFile()) {
      throw new Error("Git diff does not support directories or submodules");
    }
    // O_NOFOLLOW closes a final-component replacement race between lstat and open.
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (
        opened.dev !== metadata.dev ||
        opened.ino !== metadata.ino ||
        (await realpath(parent)) !== parent
      ) {
        throw new Error(
          "Git file changed identity while opening it; retry the read",
        );
      }
      if (
        !opened.isFile() ||
        (sampleBytes === undefined && opened.size > MAX_CONTENT_BYTES)
      ) {
        throw new Error(
          `Git file content exceeded ${MAX_CONTENT_BYTES} bytes or is not a regular file`,
        );
      }
      const chunks: Buffer[] = [];
      let size = 0;
      // A stream bounds growth during the read too, unlike a size check + readFile.
      for await (const chunk of handle.createReadStream({
        autoClose: false,
        signal,
        ...(sampleBytes === undefined ? {} : { end: sampleBytes - 1 }),
      })) {
        size += chunk.length;
        if (size > MAX_CONTENT_BYTES) {
          throw new Error(
            `Git file content exceeded ${MAX_CONTENT_BYTES} bytes`,
          );
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } finally {
      await handle.close();
    }
  } catch (cause) {
    signal?.throwIfAborted();
    if (isMissing(cause)) {
      return null;
    }
    throw cause;
  }
};

// Conflict XY codes use a generic modified summary: the conflict area carries
// that state without pretending there is a single resolved two-way comparison.
const statusName = ({ code }: ParsedStatusChange): GitChange["status"] =>
  code === "A"
    ? "added"
    : code === "D"
      ? "deleted"
      : code === "R" || code === "C"
        ? "renamed"
        : code === "?"
          ? "untracked"
          : "modified";

const binaryPaths = (output: Buffer) => {
  const records = output.toString("utf8").split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < records.length; index += 1) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(records[index]!);
    if (match) {
      const path = match[3] === "" ? records[index + 2]! : match[3]!;
      if (match[1] === "-" || match[2] === "-") {
        paths.add(path);
      }
      if (match[3] === "") {
        index += 2;
      }
    }
  }
  return paths;
};
const diffFlags = [
  "--no-ext-diff",
  "--no-textconv",
  "--find-renames=50%",
  "--ignore-submodules=none",
];

const untrackedBinary = async (options: ReadOptions & { file: string }) => {
  // Match Git's bounded binary sniff rather than loading a huge untracked file
  // just to list it. A UTF-8 character split at the sample boundary is not binary.
  const sample = await readWorkingFile({ ...options, sampleBytes: 8192 });
  if (sample === null) {
    return false;
  }
  if (sample.includes(0)) {
    return true;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample, {
      stream: sample.length === 8192,
    });
    return false;
  } catch {
    return true;
  }
};

export const readStatus = async ({
  repository,
  signal,
}: ReadOptions): Promise<GitStatus> => {
  const [status, staged, unstaged] = await Promise.all([
    runGit(
      repository.repoRoot,
      [
        "status",
        "--porcelain=v2",
        "-z",
        "--branch",
        "--untracked-files=all",
        "--find-renames=50%",
        "--ignore-submodules=none",
      ],
      { signal },
    ),
    runGit(
      repository.repoRoot,
      ["diff", "--cached", "--numstat", "-z", ...diffFlags, "--"],
      { signal },
    ),
    runGit(
      repository.repoRoot,
      ["diff", "--numstat", "-z", ...diffFlags, "--"],
      { signal },
    ),
  ]);
  const parsed = parseGitStatus(status);
  const binaries = {
    staged: binaryPaths(staged),
    unstaged: binaryPaths(unstaged),
  };
  const changes: GitChange[] = [];
  // Summaries never build hunks or read tracked blobs. Only untracked files need
  // direct classification because Git's numstat intentionally excludes them.
  for (const change of parsed.changes) {
    const directory = change.path.endsWith("/");
    const binary =
      change.trackedSubmodule ||
      directory ||
      (change.code === "?"
        ? await untrackedBinary({ repository, file: change.path, signal })
        : change.area === "conflict"
          ? binaries.staged.has(change.path) ||
            binaries.unstaged.has(change.path)
          : binaries[change.area].has(change.path));
    changes.push({
      path: directory ? change.path.slice(0, -1) : change.path,
      area: change.area,
      status: statusName(change),
      binary,
      ...(change.previousPath === undefined
        ? {}
        : { previousPath: change.previousPath }),
    });
  }
  return { repoRoot: repository.repoRoot, branch: parsed.branch, changes };
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

const parseRawChanges = (output: Buffer): RawChange[] => {
  const records = output.toString("utf8").split("\0");
  const changes: RawChange[] = [];
  for (let index = 0; index < records.length - 1; index += 1) {
    const match = /^:(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])\d*$/.exec(
      records[index]!,
    );
    if (!match) {
      throw new Error("Invalid Git raw diff record");
    }
    const renamed = match[5] === "R" || match[5] === "C";
    const source = records[index + 1]!;
    changes.push({
      path: records[index + (renamed ? 2 : 1)]!,
      ...(renamed ? { previousPath: source } : {}),
      code: match[5]!,
      old: { mode: match[1]!, oid: match[3]! },
      next: { mode: match[2]!, oid: match[4]! },
    });
    index += renamed ? 2 : 1;
  }
  return changes;
};

const selectedIndexEntry = async ({
  repository,
  file,
  signal,
}: ReadOptions & { file: string }): Promise<GitEntry | null> => {
  const output = await runGit(
    repository.repoRoot,
    ["ls-files", "--stage", "-z", "--", file],
    { signal },
  );
  const entries = output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = /^(\d+) ([a-f0-9]+) ([0-3])\t(.*)$/s.exec(record);
      if (!match) {
        throw new Error("Invalid Git index entry");
      }
      return {
        mode: match[1]!,
        oid: match[2]!,
        stage: match[3],
        path: match[4],
      };
    })
    .filter((entry) => entry.path === file);
  if (entries.some((entry) => entry.stage !== "0")) {
    throw new Error("Git diff does not support conflicted files");
  }
  return entries[0] ?? null;
};

const selectedTreeEntry = async ({
  repository,
  commit,
  file,
  signal,
}: ReadOptions & {
  commit: string | null;
  file: string;
}): Promise<GitEntry | null> => {
  if (commit === null) {
    return null;
  }
  const output = await runGit(
    repository.repoRoot,
    ["ls-tree", "-z", commit, "--", file],
    { signal },
  );
  const match = /^(\d+) \S+ ([a-f0-9]+)\t/.exec(output.toString("utf8"));
  return match ? { mode: match[1]!, oid: match[2]! } : null;
};

const readBlob = async ({
  repository,
  entry,
  signal,
}: ReadOptions & { entry: GitEntry | null }): Promise<Buffer | null> => {
  if (!entry || entry.mode === "000000") {
    return null;
  }
  if (entry.mode === "160000" || entry.mode === "040000") {
    throw new Error("Git diff does not support directories or submodules");
  }
  return runGit(repository.repoRoot, ["cat-file", "blob", entry.oid], {
    signal,
  });
};

export const captureDiff = async ({
  repository,
  file,
  comparison,
  signal,
}: ReadOptions & {
  file: string;
  comparison: GitComparison;
}): Promise<DiffSides> => {
  gitFileSchema.parse(file);
  assertFileOutsideMetadata(repository, join(repository.repoRoot, file));
  const commit =
    comparison.base.kind === "commit"
      ? await resolveCommit({ repository, ref: comparison.base.ref, signal })
      : null;
  const base =
    comparison.base.kind === "commit"
      ? (commit ??
        gitPath(
          await runGit(
            repository.repoRoot,
            ["hash-object", "-t", "tree", "--stdin"],
            { signal, input: "" },
          ),
        ))
      : null;
  // Whole-repository metadata is needed for Git's ordinary similarity-based
  // renames. No file payloads are eagerly loaded, and no external diff runs.
  const raw = await runGit(
    repository.repoRoot,
    [
      "diff",
      "--raw",
      "-z",
      "--no-abbrev",
      ...diffFlags,
      ...(comparison.target === "index" ? ["--cached"] : []),
      ...(base ? [base] : []),
      "--",
    ],
    { signal },
  );
  const changes = parseRawChanges(raw);
  const change = changes.find((entry) => entry.path === file);
  const renamedAway = changes.some((entry) => entry.previousPath === file);
  const index = await selectedIndexEntry({ repository, file, signal });
  if (change?.code === "U") {
    throw new Error("Git diff does not support conflicted files");
  }
  if (
    index?.mode === "160000" ||
    change?.old.mode === "160000" ||
    change?.next.mode === "160000"
  ) {
    throw new Error("Git diff does not support directories or submodules");
  }
  const oldEntry =
    change?.old ??
    (comparison.base.kind === "index"
      ? index
      : await selectedTreeEntry({ repository, commit, file, signal }));
  // Raw --cached carries both captured blob IDs. For unchanged files the base
  // blob is also the index blob at that read; later index content must not be
  // mixed into that pair. The separate index lookup only checks unsupported states.
  const [oldBytes, newBytes] = await Promise.all([
    readBlob({ repository, entry: oldEntry, signal }),
    comparison.target === "index"
      ? readBlob({
          repository,
          entry: change?.next ?? (renamedAway ? null : oldEntry),
          signal,
        })
      : readWorkingFile({ repository, file, signal }),
  ]);
  return {
    file,
    ...(change?.previousPath === undefined
      ? {}
      : { previousPath: change.previousPath }),
    oldBytes,
    newBytes,
  };
};
