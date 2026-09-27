// Connects Overmux to one tmux server using control mode (`tmux -C`).
//
// Tmux contains sessions (workspaces), windows (tabs), and panes (terminals).
// A snapshot is the latest complete description of that structure.
//
// backend.run(args)       Sends a tmux command.
// backend.refresh()       Rereads tmux and saves a new snapshot.
// backend.state()         Returns the saved snapshot without rereading tmux.
// backend.subscribe(fn)   Calls fn when the snapshot changes.
// backend.subscribeNotifications(fn)
//                         Calls fn for tmux's own change messages.
//
// Change messages trigger a refresh after a brief wait, grouping related events.
// A periodic refresh catches pane details tmux may not announce, such as the
// current directory or command, and repairs state after connection gaps.
// It runs only while state subscribers exist.
// Concurrent refresh requests share work instead of flooding tmux.
// Failed reads publish an empty, disconnected state.
// Cancelled reads leave the existing snapshot unchanged.
import { z } from "zod";

import {
  isTmuxPaneId,
  isTmuxSessionId,
  isTmuxWindowId,
  tmuxFormats,
} from "../../shared/tmux-values";
import {
  type TmuxBackend,
  type TmuxSession,
  type TmuxState,
  type TmuxWindow,
} from "../backend";
import {
  createTmuxControlClient,
  type TmuxControlClient,
  type TmuxControlClientOptions,
} from "./client";
import type { TmuxControlNotification } from "./parser";
import { TmuxVersionError } from "./version";

// ASCII Unit Separator preserves spaces in tmux fields, e.g. `$1␟work project␟@2`.
const separator = "\u001f";

const optionsSchema = z
  .object({
    configPath: z.string().min(1).optional(),
    id: z.string().min(1).default("default"),
    notificationDebounceMs: z.number().int().nonnegative().default(4),
    reconcileIntervalMs: z.number().int().positive().default(30_000),
    socket: z.string().min(1).default("default"),
  })
  .strict();

export type TmuxControlBackendOptions = z.input<typeof optionsSchema> & {
  controlClientFactory?: (
    options: TmuxControlClientOptions,
  ) => TmuxControlClient;
};

type RefreshRequest = {
  reject: (cause: unknown) => void;
  removeAbortListener: () => void;
  resolve: (state: TmuxState) => void;
};
type RefreshCycle = {
  controller: AbortController;
  started: boolean;
  requests: Set<RefreshRequest>;
};
type StateTracking = {
  current: TmuxState;
  versionError: TmuxVersionError | undefined;
  listeners: Set<() => void>;
  reconciliationTimer: NodeJS.Timeout | undefined;
};
// Tmux calls unsolicited control-mode messages "notifications".
type NotificationTracking = {
  listeners: Set<(event: TmuxControlNotification) => void>;
  refreshTimer: NodeJS.Timeout | undefined;
  observingControlNotifications: boolean;
};

const outputLines = (value: string) => value.trim().split("\n").filter(Boolean);
const emptyState = (id: string): TmuxState => ({
  backend: { id },
  connected: false,
  hierarchy: { sessions: [] },
});

const sessionsByIdFromOutput = (output: string) => {
  const sessions = new Map<string, TmuxSession>();
  outputLines(output).forEach((line) => {
    const [id = "", name = "", activeWindowId = ""] = line.split(separator);
    if (!isTmuxSessionId(id) || !isTmuxWindowId(activeWindowId)) {
      return;
    }
    sessions.set(id, {
      activeWindowId,
      id,
      name,
      windows: [],
    });
  });
  return sessions;
};

const addPanesFromOutput = (
  sessions: Map<string, TmuxSession>,
  output: string,
) => {
  const windowsBySessionAndId = new Map<string, TmuxWindow>();
  outputLines(output).forEach((line) => {
    const [
      sessionId = "",
      windowId = "",
      windowIndex = "",
      windowName = "",
      activeFlag = "",
      paneId = "",
      paneIndex = "",
      path = "",
      title = "",
      currentCommand = "",
      copyModeFlag = "",
    ] = line.split(separator);
    const session = sessions.get(sessionId);
    if (!session || !isTmuxWindowId(windowId) || !isTmuxPaneId(paneId)) {
      return;
    }
    const windowKey = `${sessionId}${separator}${windowId}`;
    const window = windowsBySessionAndId.get(windowKey) ?? {
      activePaneId: "",
      id: windowId,
      index: Number(windowIndex),
      name: windowName || "tmux",
      panes: [],
    };
    if (!windowsBySessionAndId.has(windowKey)) {
      windowsBySessionAndId.set(windowKey, window);
      session.windows.push(window);
    }
    if (activeFlag === "1") {
      window.activePaneId = paneId;
    }
    window.panes.push({
      currentCommand: currentCommand || "unknown",
      id: paneId,
      inCopyMode: copyModeFlag === "1",
      index: Number(paneIndex),
      path,
      title,
    });
  });
};

export const tmuxHierarchyFromOutput = (sessions: string, panes: string) => {
  const sessionsById = sessionsByIdFromOutput(sessions);
  addPanesFromOutput(sessionsById, panes);
  return { sessions: [...sessionsById.values()] };
};

const hasSameSnapshot = (left: TmuxState, right: TmuxState) =>
  JSON.stringify(left) === JSON.stringify(right);

const createRefreshCycle = (): RefreshCycle => ({
  controller: new AbortController(),
  started: false,
  requests: new Set(),
});

const waitForRefresh = (cycle: RefreshCycle, signal?: AbortSignal) =>
  new Promise<TmuxState>((resolve, reject) => {
    const removeAbortListener = () =>
      signal?.removeEventListener("abort", abort);
    const request = { reject, removeAbortListener, resolve };
    const abort = () => {
      cycle.requests.delete(request);
      removeAbortListener();
      reject(signal?.reason);
      if (cycle.started && !cycle.requests.size) {
        cycle.controller.abort(signal?.reason);
      }
    };
    cycle.requests.add(request);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });

const settleRefresh = (
  cycle: RefreshCycle,
  result: { cause: unknown } | { state: TmuxState },
) => {
  cycle.requests.forEach((request) => {
    request.removeAbortListener();
    if ("state" in result) {
      request.resolve(result.state);
    } else {
      request.reject(result.cause);
    }
  });
  cycle.requests.clear();
};

const createRefresh = (
  readState: (signal?: AbortSignal) => Promise<TmuxState>,
): TmuxBackend["refresh"] => {
  let active: RefreshCycle | undefined;
  let pending: RefreshCycle | undefined;

  // Requests arriving during a read share one trailing read instead of piling up.
  const execute = async (cycle: RefreshCycle) => {
    if (!cycle.requests.size) {
      active = undefined;
      return;
    }
    cycle.started = true;
    try {
      settleRefresh(cycle, {
        state: await readState(cycle.controller.signal),
      });
    } catch (cause) {
      settleRefresh(cycle, { cause });
    }
    const next = pending;
    pending = undefined;
    if (!next?.requests.size) {
      active = undefined;
      return;
    }
    active = next;
    void execute(next);
  };

  return (signal) => {
    if (!active) {
      const cycle = createRefreshCycle();
      active = cycle;
      const state = waitForRefresh(cycle, signal);
      void execute(cycle);
      return state;
    }
    if (!pending) {
      pending = createRefreshCycle();
    }
    return waitForRefresh(pending, signal);
  };
};

const sessionFormat = [
  tmuxFormats.sessionId,
  tmuxFormats.sessionName,
  tmuxFormats.windowId,
].join(separator);
const paneFormat = [
  tmuxFormats.sessionId,
  tmuxFormats.windowId,
  tmuxFormats.windowIndex,
  tmuxFormats.windowName,
  tmuxFormats.paneActive,
  tmuxFormats.paneId,
  tmuxFormats.paneIndex,
  tmuxFormats.paneCurrentPath,
  tmuxFormats.paneTitle,
  tmuxFormats.paneCurrentCommand,
  tmuxFormats.paneInMode,
].join(separator);

export const defineTmuxControlBackend = (
  rawOptions: TmuxControlBackendOptions = {},
): TmuxBackend => {
  const { controlClientFactory, ...schemaInput } = rawOptions;
  const options = optionsSchema.parse(schemaInput);
  const client = (controlClientFactory ?? createTmuxControlClient)({
    socket: options.socket,
  });
  const state: StateTracking = {
    current: emptyState(options.id),
    versionError: undefined,
    listeners: new Set(),
    reconciliationTimer: undefined,
  };
  const notifications: NotificationTracking = {
    listeners: new Set(),
    refreshTimer: undefined,
    observingControlNotifications: false,
  };

  const publishState = (next: TmuxState, versionError?: TmuxVersionError) => {
    if (
      hasSameSnapshot(state.current, next) &&
      state.versionError?.message === versionError?.message
    ) {
      return state.current;
    }
    state.current = next;
    state.versionError = versionError;
    state.listeners.forEach((listener) => listener());
    return state.current;
  };
  const ensureControlNotifications = () => {
    if (notifications.observingControlNotifications) {
      return;
    }
    client.subscribe((event) => {
      notifications.listeners.forEach((listener) => listener(event));
      if (notifications.refreshTimer) {
        clearTimeout(notifications.refreshTimer);
      }
      notifications.refreshTimer = setTimeout(() => {
        notifications.refreshTimer = undefined;
        void refresh().catch(() => undefined);
      }, options.notificationDebounceMs);
      notifications.refreshTimer.unref();
    });
    notifications.observingControlNotifications = true;
  };
  const run = (args: readonly string[], signal?: AbortSignal) => {
    // Observe notifications before commands so state changes cannot race the cache.
    ensureControlNotifications();
    return client.command(args, { signal });
  };
  const readAndPublishState = async (signal?: AbortSignal) => {
    try {
      const sessions = await run(
        ["list-sessions", "-F", sessionFormat],
        signal,
      );
      const panes = await run(["list-panes", "-a", "-F", paneFormat], signal);
      return publishState({
        ...emptyState(options.id),
        connected: true,
        hierarchy: tmuxHierarchyFromOutput(sessions, panes),
      });
    } catch (cause) {
      if (signal?.aborted) {
        throw cause;
      }
      const versionError =
        cause instanceof TmuxVersionError ? cause : undefined;
      const disconnected = publishState(emptyState(options.id), versionError);
      // Unsupported versions must reach resource/operation callers, not look like an absent server.
      if (versionError) {
        throw versionError;
      }
      return disconnected;
    }
  };
  const refresh = createRefresh(readAndPublishState);

  return {
    ...(options.configPath ? { configPath: options.configPath } : {}),
    id: options.id,
    refresh,
    run,
    socket: options.socket,
    state: () => {
      if (state.versionError) {
        throw state.versionError;
      }
      return state.current;
    },
    subscribeNotifications: (listener) => {
      ensureControlNotifications();
      notifications.listeners.add(listener);
      return () => notifications.listeners.delete(listener);
    },
    subscribe: (listener) => {
      ensureControlNotifications();
      state.listeners.add(listener);
      if (!state.reconciliationTimer) {
        state.reconciliationTimer = setInterval(
          () => void refresh().catch(() => undefined),
          options.reconcileIntervalMs,
        );
        state.reconciliationTimer.unref();
      }
      return () => {
        state.listeners.delete(listener);
        if (!state.listeners.size && state.reconciliationTimer) {
          clearInterval(state.reconciliationTimer);
          state.reconciliationTimer = undefined;
        }
      };
    },
  };
};
