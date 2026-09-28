// Shares one non-polling watcher setup per canonical repository, never authorization or results.
// The last listener owns teardown; failures stay observable until that setup is released.
import { watch, type FSWatcher } from "chokidar";
import { join } from "node:path";

import { isWithin, type Repository } from "./repository";

type WatchEntry = {
  listeners: Set<() => void>;
  watcher?: FSWatcher;
  timer?: NodeJS.Timeout;
  error?: Error;
  disposed: boolean;
};

const watchers = new Map<string, WatchEntry>();

const publish = (entry: WatchEntry) => {
  if (!entry.disposed) {
    entry.listeners.forEach((invalidate) => invalidate());
  }
};

const closeWatcher = (entry: WatchEntry) => {
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.timer = undefined;
  const watcher = entry.watcher;
  entry.watcher = undefined;
  // Closing Chokidar also cancels its asynchronous initial traversal. Keep a
  // rejection handler even after the final subscriber is gone.
  void watcher
    ?.close()
    .catch((cause: unknown) =>
      console.warn("Git watcher cleanup failed", cause),
    );
};

const failWatcher = (entry: WatchEntry, cause: unknown) => {
  if (entry.disposed || entry.error) {
    return;
  }
  entry.error = new Error(
    "Git repository watcher failed; resubscribe to retry",
    { cause },
  );
  closeWatcher(entry);
  publish(entry);
};

const scheduleInvalidation = (entry: WatchEntry) => {
  if (entry.disposed || entry.error) {
    return;
  }
  // Use a bounded coalescing window instead of trailing-only debounce: a stream
  // of writes must not postpone every refresh indefinitely.
  if (!entry.timer) {
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      publish(entry);
    }, 75);
  }
};

const startWatcher = (repository: Repository, entry: WatchEntry) => {
  try {
    // Native recursive fs.watch differs in readiness and symlink traversal across
    // Linux/macOS. Chokidar uses native events (not polling), exposes readiness,
    // refuses symlink traversal, and covers newly created directories/atomic saves.
    // Linked worktrees keep index/HEAD separately from their shared refs directory.
    entry.watcher = watch(
      [
        ...new Set([
          repository.repoRoot,
          repository.worktreeGitDir,
          repository.sharedGitDir,
        ]),
      ],
      {
        persistent: false,
        ignoreInitial: true,
        followSymlinks: false,
        usePolling: false,
        ignored: (path) =>
          isWithin(join(repository.sharedGitDir, "objects"), path),
      },
    );
    entry.watcher.on("error", (cause) => failWatcher(entry, cause));
    // Chokidar's environment override wins over its explicit usePolling option.
    // Fail visibly rather than silently changing this resource's live contract.
    if (entry.watcher.options.usePolling) {
      throw new Error(
        "Git subscriptions require native watchers; unset CHOKIDAR_USEPOLLING",
      );
    }
    entry.watcher.on("all", (event, path) => {
      if (
        event === "unlinkDir" &&
        [
          repository.repoRoot,
          repository.worktreeGitDir,
          repository.sharedGitDir,
        ].includes(path)
      ) {
        failWatcher(entry, new Error("Watched Git directory was removed"));
      } else {
        scheduleInvalidation(entry);
      }
    });
    // An initial read can finish before the directory traversal installs every
    // native handle. A readiness invalidation closes that otherwise missed gap.
    entry.watcher.on("ready", () => {
      if (!entry.disposed && !entry.error) {
        publish(entry);
      }
    });
  } catch (cause) {
    failWatcher(entry, cause);
  }
};

export const watchRepository = ({
  repository,
  invalidate,
  onError,
  signal,
}: {
  repository: Repository;
  invalidate: () => void;
  onError: (error: Error) => void;
  signal: AbortSignal;
}): (() => void) => {
  signal.throwIfAborted();

  let entry = watchers.get(repository.repoRoot);
  if (!entry) {
    entry = { listeners: new Set(), disposed: false };
    watchers.set(repository.repoRoot, entry);
  }

  const owned = entry;
  // Each subscription gets a distinct identity even if callers reuse a callback.
  const listener = () => (owned.error ? onError(owned.error) : invalidate());
  owned.listeners.add(listener);

  if (owned.error) {
    queueMicrotask(() => {
      if (owned.listeners.has(listener)) {
        listener();
      }
    });
  } else if (!owned.watcher) {
    startWatcher(repository, owned);
  }

  const dispose = () => {
    signal.removeEventListener("abort", dispose);
    owned.listeners.delete(listener);
    if (owned.listeners.size === 0 && !owned.disposed) {
      owned.disposed = true;
      watchers.delete(repository.repoRoot);
      closeWatcher(owned);
    }
  };

  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted) {
    dispose();
  }

  return dispose;
};
