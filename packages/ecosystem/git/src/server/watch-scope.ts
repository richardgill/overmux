import { isUtf8 } from "node:buffer";
import { lstat, opendir, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { setImmediate } from "node:timers/promises";
import { GitCommandError, runGit } from "./execution";
import { isWithin, type Repository } from "./repository";

export type WatchKind = "worktree" | "metadata";
export type ScopeDirectory = {
  path: string;
  kind: WatchKind;
  identity: string;
};
type RegisterDirectory = (directory: ScopeDirectory) => void;

const isMissing = (cause: unknown) =>
  cause instanceof Error &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR");

const nulPaths = (output: Buffer) => {
  // The resource API uses UTF-8 strings. Refuse lossy names rather than watching
  // a different path after replacement-character decoding; reconciliation remains on.
  if (!isUtf8(output)) {
    throw new Error("Git watcher requires UTF-8 paths");
  }
  return output.toString("utf8").split("\0").filter(Boolean);
};

// Find ancestors of tracked files so ignore rules cannot prune their watches.
// Also identify submodules, which are separate repositories we do not traverse.
const trackedDirectories = async (
  repository: Repository,
  signal: AbortSignal,
) => {
  const records = nulPaths(
    await runGit(
      repository.repoRoot,
      ["ls-files", "--cached", "--stage", "-z"],
      { signal },
    ),
  );
  const ancestors = new Set<string>();
  const gitlinks = new Set<string>();
  for (let index = 0; index < records.length; index++) {
    if (index % 256 === 0) {
      signal.throwIfAborted();
      await setImmediate(undefined, { signal });
    }
    const record = records[index]!;
    const path = record.slice(record.indexOf("\t") + 1);
    if (record.startsWith("160000 ")) {
      // A gitlink records a submodule commit, not files owned by this index.
      gitlinks.add(path);
    } else {
      for (
        let parent = dirname(path);
        parent !== ".";
        parent = dirname(parent)
      ) {
        ancestors.add(parent);
      }
    }
  }
  return { ancestors, gitlinks };
};

// Ask Git which candidate directories its ignore rules exclude, in one batch.
// The caller separately keeps ignored directories that contain tracked files.
const ignoredDirectories = async (
  repository: Repository,
  paths: string[],
  signal: AbortSignal,
) => {
  if (paths.length === 0) {
    return new Set<string>();
  }
  try {
    const output = await runGit(
      repository.repoRoot,
      // Unlike diff/ls-files, check-ignore rejects literal pathspec magic. Its
      // stdin takes pathnames; ./ also protects names starting with :(magic).
      // These are existing directories, so Git can stat them. Do NOT append /:
      // e.g. build/* matches the empty suffix of build/ and wrongly prunes build.
      ["--no-literal-pathspecs", "check-ignore", "--no-index", "-z", "--stdin"],
      {
        signal,
        input: paths.map((path) => `./${path}\0`).join(""),
      },
    );
    return new Set(nulPaths(output).map((path) => path.slice(2)));
  } catch (cause) {
    // check-ignore's exit 1 means none matched, not a failure to classify.
    if (cause instanceof GitCommandError && cause.status === 1) {
      return new Set<string>();
    }
    throw cause;
  }
};

const directoryChildren = async (
  path: string,
  kind: WatchKind,
  signal: AbortSignal,
  register: RegisterDirectory,
) => {
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || (await realpath(path)) !== path) {
      return [];
    }
    signal.throwIfAborted();
    // Install the parent before enumerating: a moved-in populated tree must not
    // leave a gap between discovery and notification coverage.
    register({ path, kind, identity: `${stats.dev}:${stats.ino}` });
    signal.throwIfAborted();
    const children: string[] = [];
    // latin1 preserves directory-entry bytes for explicit UTF-8 validation.
    const directory = await opendir(path, { encoding: "latin1" });
    for await (const child of directory) {
      signal.throwIfAborted();
      if (child.isDirectory()) {
        const name = Buffer.from(child.name, "latin1");
        if (!isUtf8(name)) {
          throw new Error("Git watcher requires UTF-8 paths");
        }
        if (name.toString() !== ".git") {
          children.push(join(path, name.toString()));
        }
      }
    }
    return children;
  } catch (cause) {
    if (isMissing(cause)) {
      return [];
    }
    throw cause;
  }
};

const readDirectoryBatch = async (
  paths: string[],
  kind: WatchKind,
  signal: AbortSignal,
  register: RegisterDirectory,
) => {
  // Drain the whole bounded batch even on failure: a rejected scan must not
  // leave siblings registering handles concurrently with its recovery scan.
  const results = await Promise.allSettled(
    paths.map((path) => directoryChildren(path, kind, signal, register)),
  );
  return results.flatMap((result) => {
    if (result.status === "rejected") {
      throw result.reason;
    }
    return result.value;
  });
};

const collectWorktreeScope = async (
  repository: Repository,
  signal: AbortSignal,
  register: RegisterDirectory,
) => {
  const { ancestors, gitlinks } = await trackedDirectories(repository, signal);
  const pending = [repository.repoRoot];
  // Git owns nested precedence, negation, info/exclude and global configuration.
  // --no-index asks about rules only; tracked ancestors override those answers.
  // Directory scope idea: https://github.com/esmuellert/codediff/blob/9006710244fc4f13cd6779a48f2387aa7235c23e/crates/watcher/src/scope.rs
  for (let offset = 0; offset < pending.length;) {
    signal.throwIfAborted();
    const batch = pending.slice(offset, offset + 32);
    offset += batch.length;
    const children = (
      await readDirectoryBatch(batch, "worktree", signal, register)
    )
      .filter(
        (path) =>
          ![repository.sharedGitDir, repository.worktreeGitDir].some((root) =>
            isWithin(root, path),
          ),
      )
      .map((path) => relative(repository.repoRoot, path))
      .filter((path) => !gitlinks.has(path));
    for (let start = 0; start < children.length; start += 256) {
      const candidates = children.slice(start, start + 256);
      const ignored = await ignoredDirectories(repository, candidates, signal);
      pending.push(
        ...candidates
          .filter((path) => ancestors.has(path) || !ignored.has(path))
          .map((path) => join(repository.repoRoot, path)),
      );
    }
    await setImmediate(undefined, { signal });
  }
};

// Watch Git's internal directories for staging, branch, ref and ignore-rule changes,
// without crawling unrelated metadata such as objects, logs or hooks.
const collectMetadataScope = async (
  repository: Repository,
  signal: AbortSignal,
  register: RegisterDirectory,
) => {
  // Linked worktrees own index/HEAD separately, but share refs and info/exclude.
  // Never descend into objects, logs, hooks or other worktrees' administrative dirs.
  for (const root of new Set([
    repository.worktreeGitDir,
    repository.sharedGitDir,
  ])) {
    await readDirectoryBatch(
      [root, join(root, "info")],
      "metadata",
      signal,
      register,
    );
    const refs = [join(root, "refs")];
    for (let offset = 0; offset < refs.length;) {
      const batch = refs.slice(offset, offset + 32);
      offset += batch.length;
      const children = await readDirectoryBatch(
        batch,
        "metadata",
        signal,
        register,
      );
      refs.push(...children);
      await setImmediate(undefined, { signal });
    }
  }
};

export const collectWatchScope = async (
  repository: Repository,
  signal: AbortSignal,
  onDirectory?: RegisterDirectory,
): Promise<Map<string, WatchKind>> => {
  signal.throwIfAborted();
  const scope = new Map<string, WatchKind>();
  const register: RegisterDirectory = (directory) => {
    signal.throwIfAborted();
    scope.set(directory.path, directory.kind);
    onDirectory?.(directory);
  };
  // Cover index/config replacement before using them to classify the worktree.
  await collectMetadataScope(repository, signal, register);
  await collectWorktreeScope(repository, signal, register);
  return scope;
};
