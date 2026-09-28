// Shares one native watcher setup per canonical repository, never authorization or results.
// The last listener owns teardown; reconciliation repairs lost events and partial coverage.
import { watch, type FSWatcher } from "node:fs";
import { basename, join } from "node:path";
import {
  collectWatchScope,
  type ScopeDirectory,
  type WatchKind,
} from "./watch-scope";
import type { Repository } from "./repository";

type DirectoryWatch = { watcher: FSWatcher; identity: string };
type WatchEntry = {
  repository: Repository;
  listeners: Set<() => void>;
  directories: Map<string, DirectoryWatch>;
  controller: AbortController;
  timer?: NodeJS.Timeout;
  scopeTimer?: NodeJS.Timeout;
  scanning: boolean;
  scopePending: boolean;
  warned: boolean;
  disposed: boolean;
};

const watchers = new Map<string, WatchEntry>();
// Shared by every comparison/client on this root, and only while subscribed.
// Reconciliation re-reads contents too: unchanged status does not mean unchanged diff.
const reconciliationIntervalMs = 30_000;

const publish = (entry: WatchEntry) => {
  if (!entry.disposed) {
    entry.listeners.forEach((invalidate) => invalidate());
  }
};

const closeWatcher = (entry: WatchEntry) => {
  clearTimeout(entry.timer);
  clearTimeout(entry.scopeTimer);
  entry.controller.abort();
  entry.directories.forEach(({ watcher }) => watcher.close());
  entry.directories.clear();
};

const reportDegraded = (entry: WatchEntry, cause: unknown) => {
  if (!entry.disposed && !entry.warned) {
    entry.warned = true;
    console.warn(
      "Git watch coverage incomplete; reconciling and retrying every 30 seconds",
      cause,
    );
  }
};

const scheduleInvalidation = (entry: WatchEntry) => {
  if (entry.disposed) {
    return;
  }
  // Use a bounded coalescing window instead of trailing-only debounce: a stream
  // of writes must not postpone every refresh indefinitely.
  if (!entry.timer) {
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      publish(entry);
    }, 75);
    entry.timer.unref();
  }
};

const relevantMetadata = (
  repository: Repository,
  path: string,
  name: string,
) => {
  if ([repository.worktreeGitDir, repository.sharedGitDir].includes(path)) {
    return [
      "index",
      "HEAD",
      "packed-refs",
      "refs",
      "info",
      "config",
      "config.worktree",
      "commondir",
      "gitdir",
    ].includes(name);
  }
  if (
    [
      join(repository.worktreeGitDir, "info"),
      join(repository.sharedGitDir, "info"),
    ].includes(path)
  ) {
    return name === "exclude";
  }
  return !name.endsWith(".lock");
};

const directoryEvent = (
  entry: WatchEntry,
  path: string,
  kind: WatchKind,
  event: string,
  filename: string | null,
) => {
  if (
    entry.disposed ||
    (kind === "metadata" &&
      filename &&
      !relevantMetadata(entry.repository, path, filename))
  ) {
    return;
  }
  // A worktree lockfile is ordinary content (Cargo.lock, pnpm-lock.yaml, etc.).
  scheduleInvalidation(entry);
  if (
    event === "rename" ||
    !filename ||
    kind === "metadata" ||
    basename(filename) === ".gitignore"
  ) {
    scheduleScope(entry);
  }
};

const failDirectoryWatch = (
  entry: WatchEntry,
  path: string,
  owned: DirectoryWatch,
  cause?: unknown,
) => {
  if (entry.disposed || entry.directories.get(path) !== owned) {
    return;
  }
  entry.directories.delete(path);
  owned.watcher.close();
  reportDegraded(
    entry,
    cause ?? new Error("Git directory watch closed unexpectedly"),
  );
  scheduleInvalidation(entry);
};

const installDirectory = (
  entry: WatchEntry,
  { path, kind, identity }: ScopeDirectory,
) => {
  if (entry.disposed) {
    return;
  }
  try {
    const previous = entry.directories.get(path);
    if (previous?.identity === identity) {
      return;
    }
    // Watch directory inodes, not files: Git index writes and editor saves rename
    // replacements over old files. Inode checks also repair replaced directories.
    const watcher = watch(path, { persistent: false }, (event, filename) =>
      directoryEvent(entry, path, kind, event, filename),
    );
    const owned = { watcher, identity };
    entry.directories.set(path, owned);
    previous?.watcher.close();
    watcher.on("error", (cause) =>
      failDirectoryWatch(entry, path, owned, cause),
    );
    watcher.on("close", () => failDirectoryWatch(entry, path, owned));
  } catch (cause) {
    // Permission/watch-limit failures are not healthy coverage. Keep native handles
    // that did succeed, warn once, and retry on the next shared reconciliation.
    reportDegraded(entry, cause);
  }
};

const rebuildScope = async (entry: WatchEntry) => {
  if (entry.disposed || entry.scanning) {
    return;
  }
  entry.scanning = true;
  entry.scopePending = false;
  clearTimeout(entry.scopeTimer);
  entry.scopeTimer = undefined;
  try {
    const scope = await collectWatchScope(
      entry.repository,
      entry.controller.signal,
      (directory) => installDirectory(entry, directory),
    );
    if (entry.disposed) {
      return;
    }
    // Add coverage during traversal, then remove obsolete handles only after a
    // successful classification. A failed scan must not discard known coverage.
    entry.directories.forEach(({ watcher }, path) => {
      if (!scope.has(path)) {
        watcher.close();
        entry.directories.delete(path);
      }
    });
    if (entry.directories.size === scope.size) {
      entry.warned = false;
    }
  } catch (cause) {
    reportDegraded(entry, cause);
  } finally {
    entry.scanning = false;
    if (!entry.disposed) {
      // An initial read can finish before the directory traversal installs every
      // native handle. A readiness invalidation closes that otherwise missed gap.
      // Also run after failures: native notifications are an accelerator, not truth.
      scheduleInvalidation(entry);
      scheduleNextScan(entry);
    }
  }
};

const scheduleNextScan = (entry: WatchEntry) => {
  if (entry.disposed || entry.scanning) {
    return;
  }
  clearTimeout(entry.scopeTimer);
  entry.scopeTimer = setTimeout(
    () => void rebuildScope(entry),
    entry.scopePending ? 250 : reconciliationIntervalMs,
  );
  entry.scopeTimer.unref();
};

const scheduleScope = (entry: WatchEntry) => {
  if (entry.disposed || entry.scopePending) {
    return;
  }
  entry.scopePending = true;
  // Only one scope scan can run. Events arriving during it retain one pending
  // pass, including a new directory created after its parent was enumerated.
  // The first event advances the periodic scan; later events cannot postpone it.
  scheduleNextScan(entry);
};

export const watchRepository = ({
  repository,
  invalidate,
  signal,
}: {
  repository: Repository;
  invalidate: () => void;
  signal: AbortSignal;
}): (() => void) => {
  signal.throwIfAborted();

  let entry = watchers.get(repository.repoRoot);
  const isNew = !entry;
  if (!entry) {
    entry = {
      repository,
      listeners: new Set(),
      directories: new Map(),
      controller: new AbortController(),
      scanning: false,
      scopePending: false,
      warned: false,
      disposed: false,
    };
    watchers.set(repository.repoRoot, entry);
  }

  const owned = entry;
  // Each subscription gets a distinct identity even if callers reuse a callback.
  const listener = () => invalidate();
  owned.listeners.add(listener);
  if (isNew) {
    void rebuildScope(owned);
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
