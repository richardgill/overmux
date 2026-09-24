// Orchestrates one authoritative event-driven Zellij backend across pipe generations.
// Startup, anchor replacement, mutation reconciliation, and shutdown share one owned lifecycle.
// Session topology is never polled; every published state comes from a newer plugin snapshot.

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ZellijPipeExitedError,
  ZellijReconciliationTimeoutError,
} from "../install/errors";
import type { ZellijState } from "../shared/state-contract";
import { selectAnchorSession, selectReplacementAnchor } from "./anchor";
import { openZellijConnection, type ZellijConnection } from "./connection";
import { stateFromSnapshot } from "./snapshot";
import {
  defaultZellijProcessDependencies,
  type ZellijProcessDependencies,
} from "./zellij-process";

const optionsSchema = z
  .object({
    id: z.string().min(1).default("zellij"),
    session: z.string().min(1).optional(),
  })
  .strict();
const defaultStartupTimeoutMs = 30_000;
const defaultReconciliationTimeoutMs = 5_000;

export type DefineZellijBackendOptions = z.input<typeof optionsSchema>;
export type ZellijReconciliation = (
  commandOutput: string,
) => ((state: ZellijState) => boolean) | undefined;
export type ZellijBackend = {
  close: () => Promise<void>;
  executable: "zellij";
  id: string;
  mutate: (
    args: readonly string[],
    reconciliation: ZellijReconciliation,
    signal?: AbortSignal,
  ) => Promise<string>;
  read: (signal?: AbortSignal) => Promise<ZellijState>;
  state: () => ZellijState;
  subscribe: (listener: () => void) => () => void;
};

type BackendDependencies = ZellijProcessDependencies & {
  reconciliationTimeoutMs: number;
  startupTimeoutMs: number;
  uuid: () => string;
};

type ReconciliationWaiter = {
  activate: (predicate: (state: ZellijState) => boolean) => void;
  cancel: (error: unknown) => void;
  observe: (revision: number, state: ZellijState) => void;
  promise: Promise<void>;
};

const emptyState = (id: string): ZellijState => ({
  backend: { id },
  connected: false,
  sessions: [],
});
const sameState = (left: ZellijState, right: ZellijState) =>
  JSON.stringify(left) === JSON.stringify(right);

const waitWithSignal = <T>(promise: Promise<T>, signal?: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });

const createReconciliationWaiter = ({
  afterRevision,
  timeoutMs,
}: {
  afterRevision: number;
  timeoutMs: number;
}): ReconciliationWaiter => {
  const observed: ZellijState[] = [];
  let predicate: ((state: ZellijState) => boolean) | undefined;
  let settled = false;
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => undefined);
  const settle = (error?: unknown) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    if (error === undefined) {
      resolvePromise();
    } else {
      rejectPromise(error);
    }
  };
  const matchObserved = () => {
    if (predicate && observed.some(predicate)) {
      settle();
    }
  };
  const timer = setTimeout(
    () =>
      settle(
        new ZellijReconciliationTimeoutError(
          `Timed out after ${timeoutMs}ms waiting for a matching Zellij SessionUpdate.`,
        ),
      ),
    timeoutMs,
  );
  timer.unref();
  return {
    activate: (nextPredicate) => {
      predicate = nextPredicate;
      matchObserved();
    },
    cancel: settle,
    observe: (revision, state) => {
      if (!settled && revision > afterRevision) {
        observed.push(state);
        matchObserved();
      }
    },
    promise,
  };
};

const defaultDependencies: BackendDependencies = {
  ...defaultZellijProcessDependencies,
  reconciliationTimeoutMs: defaultReconciliationTimeoutMs,
  startupTimeoutMs: defaultStartupTimeoutMs,
  uuid: randomUUID,
};

export const createZellijBackend = (
  rawOptions: DefineZellijBackendOptions = {},
  dependencies: BackendDependencies = defaultDependencies,
): ZellijBackend => {
  const options = optionsSchema.parse(rawOptions);
  let current = emptyState(options.id);
  let failure: Error | undefined;
  let revision = 0;
  let connection: ZellijConnection | undefined;
  let transition: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let lifecycleController: AbortController | undefined;
  let startupWaiters = 0;
  const listeners = new Set<() => void>();
  const reconciliationWaiters = new Set<ReconciliationWaiter>();

  const publish = (state: ZellijState) => {
    revision += 1;
    reconciliationWaiters.forEach((waiter) => waiter.observe(revision, state));
    if (sameState(current, state)) {
      return;
    }
    current = state;
    listeners.forEach((listener) => listener());
  };
  const disconnectBackend = (error: Error) => {
    reconciliationWaiters.forEach((waiter) => waiter.cancel(error));
    reconciliationWaiters.clear();
    publish(emptyState(options.id));
  };
  const failBackend = (error: Error) => {
    failure = error;
    disconnectBackend(error);
  };
  const trackTransition = (task: Promise<void>) => {
    const tracked = task.finally(() => {
      if (transition === tracked) {
        transition = undefined;
      }
    });
    transition = tracked;
    return tracked;
  };
  const disposeConnection = async (target: ZellijConnection) => {
    try {
      await target.close();
    } finally {
      try {
        await target.removePlugin();
      } finally {
        if (connection === target) {
          connection = undefined;
        }
      }
    }
  };

  const connect = async (anchorSession: string, signal?: AbortSignal) => {
    const artifact = await dependencies.verifyArtifact();
    signal?.throwIfAborted();
    const connectionId = dependencies.uuid();
    let established = false;
    const child = dependencies.spawnPipe({
      anchorSession,
      artifactPath: artifact.artifactPath,
      connectionId,
    });
    const nextConnection = openZellijConnection({
      anchorSession,
      child,
      connectionId,
      onFailure: (error, replaceAnchor) => {
        if (connection !== nextConnection || stopping || !established) {
          return;
        }
        if (replaceAnchor) {
          disconnectBackend(error);
          void trackTransition(replaceConnection(nextConnection, error));
          return;
        }
        failBackend(error);
        void trackTransition(
          disposeConnection(nextConnection).catch(() => undefined),
        );
      },
      onSnapshot: (snapshot) => {
        if (connection !== nextConnection || stopping) {
          return;
        }
        const state = stateFromSnapshot(options.id, snapshot);
        established = true;
        failure = undefined;
        publish(state);
      },
      // Terminating a blocked CLI pipe does not unload its plugin, so hello identifies the exact pane to close.
      removePlugin: async (pluginId) => {
        await dependencies.runCommand([
          "--session",
          anchorSession,
          "action",
          "close-pane",
          "--pane-id",
          `plugin_${pluginId}`,
        ]);
      },
      startupTimeoutMs: dependencies.startupTimeoutMs,
    });
    connection = nextConnection;
    try {
      await nextConnection.ready;
    } catch (error) {
      await disposeConnection(nextConnection);
      throw error;
    }
  };

  const replaceConnection = async (
    previousConnection: ZellijConnection,
    exitError: Error,
  ) => {
    const signal = lifecycleController?.signal;
    try {
      await previousConnection.close();
      const sessions = await dependencies.listSessions(signal);
      if (sessions.includes(previousConnection.anchorSession)) {
        await previousConnection.removePlugin();
      }
      const anchorSession = selectReplacementAnchor({
        previousAnchor: previousConnection.anchorSession,
        sessions,
      });
      await connect(anchorSession, signal);
    } catch (error) {
      if (signal?.aborted || stopping) {
        return;
      }
      failBackend(
        error instanceof Error
          ? error
          : new ZellijPipeExitedError(
              `${exitError.message}\nAnchor replacement failed: ${String(error)}`,
            ),
      );
    }
  };

  const start = (): Promise<void> => {
    if (stopping) {
      return Promise.reject(
        new DOMException("Zellij backend is stopping", "AbortError"),
      );
    }
    if (current.connected && connection) {
      return Promise.resolve();
    }
    if (transition) {
      return transition;
    }
    failure = undefined;
    const controller = new AbortController();
    lifecycleController = controller;
    return trackTransition(
      (async () => {
        const sessions = await dependencies.listSessions(controller.signal);
        const anchorSession = selectAnchorSession({
          currentSession: process.env.ZELLIJ_SESSION_NAME,
          preferredSession: options.session,
          sessions,
        });
        await connect(anchorSession, controller.signal);
      })().catch((error: unknown) => {
        const typedError =
          error instanceof Error ? error : new Error(String(error));
        if (!controller.signal.aborted) {
          failBackend(typedError);
        }
        throw typedError;
      }),
    );
  };

  const waitForStartup = async (signal?: AbortSignal) => {
    startupWaiters += 1;
    try {
      const activeStopping = stopping;
      if (activeStopping) {
        await waitWithSignal(activeStopping, signal);
      }
      signal?.throwIfAborted();
      await waitWithSignal(start(), signal);
    } finally {
      startupWaiters -= 1;
      if (
        signal?.aborted &&
        startupWaiters === 0 &&
        !current.connected &&
        transition &&
        !stopping
      ) {
        await close();
      }
    }
  };

  const close = () => {
    if (stopping) {
      return stopping;
    }
    const activeConnection = connection;
    const activeTransition = transition;
    lifecycleController?.abort(
      new DOMException("Zellij backend closed", "AbortError"),
    );
    lifecycleController = undefined;
    connection = undefined;
    transition = undefined;
    failure = undefined;
    reconciliationWaiters.forEach((waiter) =>
      waiter.cancel(new DOMException("Zellij backend closed", "AbortError")),
    );
    reconciliationWaiters.clear();
    publish(emptyState(options.id));
    stopping = (async () => {
      activeConnection?.requestShutdown();
      try {
        await activeConnection?.removePlugin();
      } finally {
        await activeConnection?.close();
      }
      await activeTransition?.catch(() => undefined);
    })().finally(() => {
      stopping = undefined;
    });
    return stopping;
  };

  const read = async (signal?: AbortSignal) => {
    if (failure) {
      throw failure;
    }
    if (!current.connected) {
      await waitForStartup(signal);
    }
    if (failure) {
      throw failure;
    }
    return current;
  };

  const mutate = async (
    args: readonly string[],
    reconciliation: ZellijReconciliation,
    signal?: AbortSignal,
  ) => {
    await read(signal);
    const waiter = createReconciliationWaiter({
      afterRevision: revision,
      timeoutMs: dependencies.reconciliationTimeoutMs,
    });
    reconciliationWaiters.add(waiter);
    try {
      const output = await dependencies.runCommand(args, signal);
      const predicate = reconciliation(output);
      if (predicate) {
        waiter.activate(predicate);
        await waitWithSignal(waiter.promise, signal);
      }
      return output;
    } finally {
      reconciliationWaiters.delete(waiter);
      waiter.cancel(
        signal?.reason ??
          new DOMException("Zellij reconciliation ended", "AbortError"),
      );
    }
  };

  return {
    close,
    executable: "zellij",
    id: options.id,
    mutate,
    read,
    state: () => current,
    subscribe: (listener) => {
      const controller = new AbortController();
      listeners.add(listener);
      void waitForStartup(controller.signal).catch(() => undefined);
      return () => {
        listeners.delete(listener);
        controller.abort(
          new DOMException("Zellij subscription ended", "AbortError"),
        );
      };
    },
  };
};

export const defineZellijBackend = (
  options?: DefineZellijBackendOptions,
): ZellijBackend => createZellijBackend(options);

export type {
  ZellijPaneInfo,
  ZellijSession,
  ZellijState,
  ZellijTab,
  ZellijTabInfo,
} from "../shared/state-contract";
