// Supervises one disposable application child and the parent-owned update watcher.
// The coordinator retains only lifecycle state and the stable startup address.

import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { errorMessage } from "../server-logger";
import type {
  OvermuxServer,
  OvermuxServerOptions,
} from "../start-overmux-server";
import {
  parseChildMessage,
  type ChildServerOptions,
  type ParentToChildMessage,
} from "./ipc-protocol";
import { startUpdateWatcher, type UpdateWatcher } from "./update-watcher";

type ChildInstance = {
  process: ChildProcess;
  host: string;
  port: number;
  url: string;
  watch: boolean;
};

const send = (
  child: ChildProcess,
  message: ParentToChildMessage,
  onError?: (cause: Error) => void,
) => {
  if (!child.connected) {
    onError?.(new Error("Server child IPC channel is closed"));
    return;
  }
  try {
    child.send(message, (cause) => {
      if (cause) {
        onError?.(cause);
      }
    });
  } catch (cause) {
    onError?.(cause instanceof Error ? cause : new Error(String(cause)));
  }
};

const stopChild = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    let timeout: NodeJS.Timeout | undefined;
    const finish = () => {
      child.off("exit", finish);
      clearTimeout(timeout);
      resolve();
    };
    child.once("exit", finish);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish();
      return;
    }
    timeout = setTimeout(() => {
      if (!child.kill("SIGKILL")) {
        finish();
      }
    }, 5_000);
    send(child, { type: "stop" });
  });

const serverChildPath = () =>
  fileURLToPath(import.meta.resolve("#server-child"));

const startChild = (
  options: ChildServerOptions,
  onRestartRequested: () => void,
): Promise<ChildInstance> =>
  new Promise((resolve, reject) => {
    const child = fork(serverChildPath(), [], {
      serialization: "json",
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    let settled = false;
    const fail = (cause: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    child.on("error", fail);
    child.on("exit", (code, signal) => {
      fail(
        new Error(
          `Server child exited before readiness (${signal ?? code ?? "unknown"})`,
        ),
      );
    });
    child.on("message", (raw) => {
      let message;
      try {
        message = parseChildMessage(raw);
      } catch (cause) {
        fail(cause);
        return;
      }
      if (message.type === "restart-requested") {
        if (settled) {
          onRestartRequested();
        }
        return;
      }
      if (message.type === "startup-failed") {
        fail(new Error(message.message));
        return;
      }
      if (!settled) {
        settled = true;
        resolve({
          host: message.host,
          port: message.port,
          process: child,
          url: message.url,
          watch: message.watch,
        });
      }
    });
    send(child, { options, type: "start" }, fail);
  });

export const startServerCoordinator = async (
  initialOptions: OvermuxServerOptions,
): Promise<OvermuxServer> => {
  let child: ChildInstance | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let restartPromise: Promise<void> | undefined;
  let updateDuringRestart = false;
  let startupAddress: { host: string; port: number } | undefined;
  let watcher: UpdateWatcher | undefined;

  const adoptChild = (next: ChildInstance) => {
    child = next;
    next.process.once("exit", () => {
      if (child?.process === next.process) {
        child = undefined;
      }
    });
  };

  const restart = () => {
    if (closed || restartPromise) {
      return restartPromise ?? Promise.resolve();
    }
    restartPromise = (async () => {
      const previous = child;
      child = undefined;
      if (previous) {
        await stopChild(previous.process);
      }
      if (closed || !startupAddress) {
        return;
      }
      try {
        const replacement = await startChild(
          {
            ...initialOptions,
            host: startupAddress.host,
            port: startupAddress.port,
          },
          () => void restart(),
        );
        if (closed) {
          await stopChild(replacement.process);
          return;
        }
        adoptChild(replacement);
        if (updateDuringRestart) {
          updateDuringRestart = false;
          send(replacement.process, { type: "update-available" });
        }
      } catch (cause) {
        process.stderr.write(
          `[overmux] replacement child failed: ${errorMessage(cause)}\n`,
        );
      }
    })().finally(() => {
      const shouldRetry = updateDuringRestart && !child && !closed;
      updateDuringRestart = false;
      restartPromise = undefined;
      if (shouldRetry) {
        void restart();
      }
    });
    return restartPromise;
  };

  const onUpdate = () => {
    if (closed) {
      return;
    }
    if (restartPromise) {
      updateDuringRestart = true;
      return;
    }
    if (child) {
      send(child.process, { type: "update-available" });
      return;
    }
    void restart();
  };

  const initial = await startChild(initialOptions, () => void restart());
  startupAddress = { host: initial.host, port: initial.port };
  adoptChild(initial);
  try {
    if (initial.watch) {
      watcher = startUpdateWatcher({
        configPath: initialOptions.configPath,
        onUpdate,
      });
    }
  } catch (cause) {
    await stopChild(initial.process);
    throw cause;
  }

  const close = () => {
    if (closePromise) {
      return closePromise;
    }
    closed = true;
    closePromise = (async () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      watcher?.close();
      const active = child;
      child = undefined;
      if (active) {
        await stopChild(active.process);
      }
      await restartPromise;
    })();
    return closePromise;
  };
  const onSignal = () => {
    void close().catch((cause: unknown) => {
      process.stderr.write(
        `[overmux] coordinator shutdown failed: ${errorMessage(cause)}\n`,
      );
    });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  return {
    announceUpdateAvailable: onUpdate,
    close,
    port: initial.port,
    url: initial.url,
  };
};
