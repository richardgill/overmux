import { watch } from "node:fs";

import { runGit } from "./git-execution";

export type GitRepositoryWatcher = {
  dispose: () => void;
};

// Watch the checked-out files and Git's metadata because either can change status.
// A linked worktree has its own Git directory, while refs live in a shared common directory.
const repositoryWatchPaths = async (root: string, signal?: AbortSignal) => {
  const [gitDir, gitCommonDir] = await Promise.all([
    runGit(root, ["rev-parse", "--absolute-git-dir"], { signal }).then(
      ({ stdout }) => stdout.toString("utf8").trim(),
    ),
    runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      signal,
    }).then(({ stdout }) => stdout.toString("utf8").trim()),
  ]);
  return [...new Set([root, gitDir, gitCommonDir])];
};

export const watchGitRepository = async ({
  debounceMs,
  invalidate,
  root,
  signal,
}: {
  debounceMs: number;
  invalidate: () => void;
  root: string;
  signal?: AbortSignal;
}): Promise<GitRepositoryWatcher> => {
  const paths = await repositoryWatchPaths(root, signal);
  let disposed = false;
  let timer: NodeJS.Timeout | undefined;
  // File systems often emit several events for one Git operation, so wait for
  // changes to settle before asking consumers to refresh.
  const publish = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      if (!disposed) {
        invalidate();
      }
    }, debounceMs);
  };
  // A watcher can fail after creation if its directory is replaced. Close it
  // and notify consumers once rather than silently retaining the last snapshot.
  const watchers = paths.flatMap((path) => {
    try {
      const watcher = watch(path, { recursive: true }, publish);
      watcher.on("error", () => {
        watcher.close();
        publish();
      });
      return [watcher];
    } catch {
      return [];
    }
  });
  return {
    dispose: () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
      watchers.forEach((watcher) => watcher.close());
    },
  };
};
