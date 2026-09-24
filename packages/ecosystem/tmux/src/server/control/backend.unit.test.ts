// Covers hierarchy construction, refresh batching, cancellation, notifications, and reconciliation.
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineTmuxControlBackend } from "./backend";
import type { TmuxControlClient } from "./client";
import type { TmuxControlNotification } from "./parser";

const separator = "\u001f";
const controlOutput = (...fields: string[]) => `${fields.join(separator)}\n`;
const sessionOutput = (name: string) => controlOutput("$1", name, "@1");
const panesOutput = controlOutput(
  "$1",
  "@1",
  "0",
  "editor",
  "1",
  "%1",
  "0",
  "/work",
  "title",
  "vim",
  "0",
);

const createBackendFixture = ({
  commandsBlockedUntil = Promise.resolve(),
}: { commandsBlockedUntil?: Promise<void> } = {}) => {
  const notificationListeners = new Set<
    (event: TmuxControlNotification) => void
  >();
  let controlDisconnected = false;
  let currentSessionOutput = sessionOutput("demo");
  const command = vi.fn(
    async (args: readonly string[], signal?: AbortSignal) => {
      signal?.throwIfAborted();
      await commandsBlockedUntil;
      signal?.throwIfAborted();
      if (controlDisconnected) {
        throw new Error("control disconnected");
      }
      if (args[0] === "list-sessions") {
        return currentSessionOutput;
      }
      if (args[0] === "list-panes") {
        return panesOutput;
      }
      throw new Error(`Unexpected control command: ${args.join(" ")}`);
    },
  );
  const client: TmuxControlClient = {
    close: async () => undefined,
    command: (args, options) => command(args, options?.signal),
    subscribe: (listener) => {
      notificationListeners.add(listener);
      return () => notificationListeners.delete(listener);
    },
  };
  const controlClientFactory = vi.fn(() => client);
  const backend = defineTmuxControlBackend({
    controlClientFactory,
    notificationDebounceMs: 4,
    reconcileIntervalMs: 30_000,
  });
  return {
    backend,
    command,
    controlClientFactory,
    disconnectControl: () => {
      controlDisconnected = true;
    },
    emitNotification: (event: TmuxControlNotification) =>
      notificationListeners.forEach((listener) => listener(event)),
    setSessionName: (name: string) => {
      currentSessionOutput = sessionOutput(name);
    },
  };
};

const commandNames = (
  command: ReturnType<typeof createBackendFixture>["command"],
) => command.mock.calls.map(([args]) => args[0]);

afterEach(() => vi.useRealTimers());

describe("tmux control backend", () => {
  it("defaults its identity and socket", () => {
    const { backend, controlClientFactory } = createBackendFixture();

    expect(backend.id).toBe("default");
    expect(backend.socket).toBe("default");
    expect(controlClientFactory).toHaveBeenCalledWith({ socket: "default" });
  });

  it("constructs typed authoritative state without shadow filtering", async () => {
    const { backend } = createBackendFixture();

    const state = await backend.refresh();

    expect(state).toMatchObject({
      connected: true,
      hierarchy: {
        sessions: [
          {
            activeWindowId: "@1",
            id: "$1",
            windows: [
              { activePaneId: "%1", panes: [{ id: "%1", path: "/work" }] },
            ],
          },
        ],
      },
    });
  });

  it("coalesces refreshes arriving during an active read", async () => {
    const { backend, command } = createBackendFixture();

    await Promise.all([
      backend.refresh(),
      backend.refresh(),
      backend.refresh(),
    ]);

    expect(commandNames(command)).toEqual([
      "list-sessions",
      "list-panes",
      "list-sessions",
      "list-panes",
    ]);
  });

  it("keeps a pending refresh usable after its first request aborts", async () => {
    let releaseCommands: () => void = () => undefined;
    const commandsBlockedUntil = new Promise<void>((resolve) => {
      releaseCommands = resolve;
    });
    const { backend, command } = createBackendFixture({ commandsBlockedUntil });
    const activeRefresh = backend.refresh();
    const controller = new AbortController();
    const cancelledRefresh = backend.refresh(controller.signal);
    const cancelledAssertion =
      expect(cancelledRefresh).rejects.toThrow("cancelled");

    controller.abort(new Error("cancelled"));
    const laterRefresh = backend.refresh();
    releaseCommands();

    await cancelledAssertion;
    await expect(activeRefresh).resolves.toMatchObject({ connected: true });
    await expect(laterRefresh).resolves.toMatchObject({ connected: true });
    expect(commandNames(command)).toEqual([
      "list-sessions",
      "list-panes",
      "list-sessions",
      "list-panes",
    ]);
  });

  it("debounces notification refreshes and publishes only changed state", async () => {
    vi.useFakeTimers();
    const { backend, command, emitNotification, setSessionName } =
      createBackendFixture();
    await backend.refresh();
    const listener = vi.fn();
    const unsubscribe = backend.subscribe(listener);
    command.mockClear();

    emitNotification({ type: "sessions-changed" });
    emitNotification({ type: "window-added", windowId: "@2" });
    await vi.advanceTimersByTimeAsync(4);

    expect(commandNames(command)).toEqual(["list-sessions", "list-panes"]);
    expect(listener).not.toHaveBeenCalled();

    setSessionName("renamed");
    emitNotification({ type: "sessions-changed" });
    await vi.advanceTimersByTimeAsync(4);

    expect(backend.state().hierarchy.sessions[0]?.name).toBe("renamed");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("publishes disconnected state after control failure", async () => {
    const { backend, disconnectControl } = createBackendFixture();
    await backend.refresh();

    disconnectControl();
    await backend.refresh();

    expect(backend.state().connected).toBe(false);
    expect(backend.state().hierarchy.sessions).toEqual([]);
  });

  it("does not publish disconnected state when a refresh is cancelled", async () => {
    const { backend } = createBackendFixture();
    await backend.refresh();
    const stateBeforeCancellation = backend.state();
    const controller = new AbortController();

    const refresh = backend.refresh(controller.signal);
    controller.abort(new Error("cancelled"));

    await expect(refresh).rejects.toThrow("cancelled");
    expect(backend.state()).toBe(stateBeforeCancellation);
  });

  it("forwards control notifications until unsubscribed", () => {
    vi.useFakeTimers();
    const { backend, emitNotification } = createBackendFixture();
    const listener = vi.fn();
    const notification: TmuxControlNotification = {
      clientName: "/dev/pts/57",
      name: "work space",
      sessionId: "$1",
      type: "client-session-changed",
    };

    const unsubscribe = backend.subscribeNotifications(listener);
    emitNotification(notification);

    expect(listener).toHaveBeenCalledWith(notification);

    unsubscribe();
    emitNotification({ type: "sessions-changed" });

    expect(listener).toHaveBeenCalledOnce();
  });

  it("uses slow reconciliation to recover a missed notification", async () => {
    vi.useFakeTimers();
    const { backend, setSessionName } = createBackendFixture();
    const unsubscribe = backend.subscribe(() => undefined);
    await backend.refresh();

    setSessionName("reconciled");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(backend.state().hierarchy.sessions[0]?.name).toBe("reconciled");
    unsubscribe();
  });
});
