import { describe, expect, it, test as testCases, vi } from "vitest";

import type {
  TmuxTerminalClientMessage,
  TmuxTerminalServerMessage,
  TmuxTerminalLocation,
} from "../shared/terminal-contracts";
import { createTmuxTerminalClient } from "./terminal-client";

const location = { sessionId: "$2", windowId: "@3", paneId: "%7" };
const setup = (status: "closed" | "open" | "opening" = "open") => {
  let listener: ((message: TmuxTerminalServerMessage) => void) | undefined;
  const onConnectionStatusChange = vi.fn();
  const onLocationChange = vi.fn();
  const onError = vi.fn();
  const send = vi.fn((_message: TmuxTerminalClientMessage) => true);
  const unsubscribe = vi.fn();
  const connection = {
    connectionId: Symbol(),
    close: vi.fn(),
    send,
    status,
    subscribe: vi.fn((next: (message: TmuxTerminalServerMessage) => void) => {
      listener = next;
      return unsubscribe;
    }),
  };
  const sink = { cancelPendingInput: vi.fn(), reset: vi.fn(), write: vi.fn() };
  const client = createTmuxTerminalClient({
    connection,
    onConnectionStatusChange,
    onLocationChange,
    onError,
    sink,
  });
  const emit = (message: TmuxTerminalServerMessage) => listener?.(message);
  const confirm = (
    requestId: number,
    revision = 1,
    confirmed: TmuxTerminalLocation = location,
  ) =>
    emit({
      type: "go-to-result",
      requestId,
      result: { outcome: "success", location: confirmed, revision },
    });
  return {
    client,
    connection,
    emit,
    confirm,
    onConnectionStatusChange,
    onLocationChange,
    onError,
    send,
    sink,
    unsubscribe,
  };
};

describe("tmux terminal client", () => {
  it("cancels pending input before sending navigation", () => {
    const { client, send, sink } = setup();
    send.mockImplementation(() => {
      expect(sink.cancelPendingInput).toHaveBeenCalledOnce();
      return true;
    });

    void client.goTo(location);

    expect(send).toHaveBeenCalledOnce();
  });

  testCases.each([
    { changed: "pane", nextLocation: { ...location, paneId: "%8" } },
    { changed: "window", nextLocation: { ...location, windowId: "@4" } },
    { changed: "session", nextLocation: { ...location, sessionId: "$3" } },
  ])(
    "cancels pending input when the observed $changed changes",
    ({ nextLocation }) => {
      const { emit, sink } = setup();
      emit({ type: "location-changed", location, revision: 1 });

      emit({ type: "location-changed", location: nextLocation, revision: 2 });

      expect(sink.cancelPendingInput).toHaveBeenCalledTimes(2);
    },
  );

  it("ignores duplicate observations and cancels once on disconnect", () => {
    const { client, emit, sink } = setup();
    emit({ type: "location-changed", location, revision: 1 });
    emit({ type: "location-changed", location, revision: 2 });
    expect(sink.cancelPendingInput).toHaveBeenCalledOnce();

    client.updateConnection({ status: "closed" });

    expect(sink.cancelPendingInput).toHaveBeenCalledTimes(2);
  });

  it("routes terminal data into the shared renderer lifecycle", () => {
    const { emit, sink } = setup();
    const bytes = Uint8Array.from([1, 2, 3]);
    emit({ bytes, sequence: 0, terminalId: "terminal-1", type: "data" });
    expect(sink.write).toHaveBeenCalledWith(bytes, expect.any(Function));
  });

  it("queues navigation until open and resolves only the correlated confirmed location", async () => {
    const { client, send, confirm, onLocationChange } = setup("opening");
    const result = client.goTo({ sessionId: "$2" });
    const resolved = vi.fn();
    void result.then(resolved);
    expect(send).not.toHaveBeenCalled();
    expect(onLocationChange).not.toHaveBeenCalled();
    for (let update = 0; update < 3; update += 1) {
      client.updateConnection({ status: "opening" });
      await Promise.resolve();
      expect(send).not.toHaveBeenCalled();
      expect(resolved).not.toHaveBeenCalled();
    }
    client.updateConnection({ status: "open" });
    expect(send).toHaveBeenCalledWith({
      type: "go-to",
      requestId: 0,
      target: { sessionId: "$2" },
    });
    confirm(99);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    confirm(0);
    await expect(result).resolves.toEqual(location);
    expect(onLocationChange).toHaveBeenCalledWith(location);
  });

  testCases.each(["opening", "open"] as const)(
    "rejects superseded requests immediately while %s and ignores late completions",
    async (status) => {
      const { client, confirm, emit, send, onLocationChange } = setup(status);
      const first = client
        .goTo({ sessionId: "$1" })
        .catch((error: Error) => error);
      const second = client.goTo(location);
      await expect(first).resolves.toMatchObject({ name: "AbortError" });
      client.updateConnection({ status: "open" });
      expect(send).toHaveBeenCalledTimes(status === "opening" ? 1 : 2);
      confirm(1, 3);
      await expect(second).resolves.toEqual(location);
      confirm(0, 99, { ...location, sessionId: "$1" });
      emit({
        type: "location-changed",
        location: { ...location, paneId: "%8" },
        revision: 2,
      });
      expect(onLocationChange.mock.calls).toEqual([[location]]);
    },
  );

  it("observes native full locations without sending navigation, including changes after confirmation", async () => {
    const { client, confirm, emit, send, onLocationChange } = setup();
    const request = client.goTo(location);
    const nativeLocation = { ...location, paneId: "%8" };
    emit({ type: "location-changed", location: nativeLocation, revision: 2 });
    confirm(0, 1);
    await expect(request).resolves.toEqual(location);
    expect(onLocationChange.mock.calls).toEqual([[nativeLocation]]);
    expect(send).toHaveBeenCalledOnce();
  });

  it("rejects server hierarchy errors while allowing another request", async () => {
    const { client, emit, confirm } = setup();
    const failed = client.goTo(location);
    emit({
      type: "go-to-result",
      requestId: 0,
      result: { outcome: "error", message: "Pane does not belong to window" },
    });
    await expect(failed).rejects.toThrow("Pane does not belong");
    const next = client.goTo(location);
    confirm(1);
    await expect(next).resolves.toEqual(location);
  });

  testCases.each([
    "disconnect",
    "error",
    "dispose",
    "send-failure",
    "send-throw",
    "output-failure",
  ] as const)(
    "settles pending navigation on %s and ignores late results after disposal/disconnect",
    async (failure) => {
      const {
        client,
        connection,
        emit,
        send,
        confirm,
        onError,
        sink,
        unsubscribe,
      } = setup();
      onError.mockImplementation(() => {
        // The navigation send cancelled once; failures must cancel again before notifying.
        expect(sink.cancelPendingInput.mock.calls.length).toBeGreaterThan(1);
      });
      if (failure === "send-failure") {
        send.mockReturnValue(false);
      }
      if (failure === "send-throw") {
        send.mockImplementation(() => {
          throw new Error("send threw");
        });
      }
      const pending = client.goTo(location);
      const rejection = expect(pending).rejects.toBeInstanceOf(Error);
      if (failure === "disconnect") {
        client.updateConnection({ status: "closed" });
      }
      if (failure === "error") {
        client.updateConnection({
          status: "open",
          error: new Error("transport failed"),
        });
      }
      if (failure === "dispose") {
        client.dispose();
      }
      if (failure === "output-failure") {
        emit({
          type: "data",
          bytes: Uint8Array.of(1),
          sequence: 9,
          terminalId: "bad",
        });
        expect(onError).toHaveBeenCalledOnce();
      }
      await rejection;
      confirm(0);
      client.dispose();
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(connection.close).toHaveBeenCalled();
    },
  );

  it("rejects queued navigation without sending when opening reports an error", async () => {
    const { client, send } = setup("opening");
    const pending = client.goTo(location);
    client.updateConnection({
      status: "open",
      error: new Error("transport failed"),
    });
    await expect(pending).rejects.toThrow("transport failed");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects navigation interrupted during opening and requires a new request after reconnect", async () => {
    const { client, send, confirm } = setup("opening");
    const pending = client.goTo(location);
    client.updateConnection({ status: "closed" });
    await expect(pending).rejects.toThrow("Tmux terminal disconnected");

    client.updateConnection({ status: "opening" });
    client.updateConnection({ status: "open" });
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();

    const retried = client.goTo(location);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: "go-to",
      requestId: 1,
      target: location,
    });
    confirm(1);
    await expect(retried).resolves.toEqual(location);
  });

  it("clears confirmed location on disconnect and does not turn it into reconnect intent", () => {
    const { client, emit, send, onLocationChange } = setup();
    emit({ type: "location-changed", location, revision: 1 });
    client.updateConnection({ status: "closed" });
    client.updateConnection({ status: "opening" });
    client.updateConnection({ status: "open" });
    expect(onLocationChange.mock.calls).toEqual([[location], [undefined]]);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects malformed hierarchy before superseding a valid request", async () => {
    const { client, confirm } = setup();
    const valid = client.goTo(location);
    await expect(
      client.goTo({ sessionId: "$1", paneId: "%1" } as never),
    ).rejects.toThrow("Invalid tmux");
    confirm(0);
    await expect(valid).resolves.toEqual(location);
  });

  it("requests redraw only while open and alive", () => {
    const { client, send } = setup("opening");
    client.redraw();
    expect(send).not.toHaveBeenCalled();

    client.updateConnection({ status: "open" });
    client.redraw();
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "redraw" });
    send.mockClear();
    client.updateConnection({ status: "closed" });
    client.redraw();
    client.dispose();
    client.redraw();
    expect(send).not.toHaveBeenCalled();
  });

  it("reports the underlying connection lifecycle once", () => {
    const { client, onConnectionStatusChange } = setup("opening");
    client.updateConnection({ status: "open" });
    client.updateConnection({ status: "closed" });
    expect(onConnectionStatusChange.mock.calls).toEqual([
      ["opening"],
      ["open"],
      ["closed"],
    ]);
  });
});
