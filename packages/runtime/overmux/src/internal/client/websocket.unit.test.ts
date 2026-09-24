import {
  encodeProtocolFrame,
  type ServerProtocolMessage,
} from "../shared/index";
import { afterEach, describe, expect, it, test as testCases, vi } from "vitest";

import { createWebSocketTransport } from "./websocket";

class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  bufferedAmount = 0;
  readyState = 0;
  sent: string[] = [];

  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  });
  send = vi.fn((message: string) => this.sent.push(message));

  open = (instanceId: string | undefined = "test-instance") => {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event("open"));
    if (instanceId) {
      this.receive({ type: "server-info", instanceId });
    }
  };

  serverClose = (code: number) => {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code }));
  };

  receive = (message: ServerProtocolMessage) => {
    const frame = encodeProtocolFrame(message);
    this.dispatchEvent(
      new MessageEvent("message", {
        data: typeof frame === "string" ? frame : frame.buffer,
      }),
    );
  };
}

describe("WebSocket", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("creates UUID-v4 operation IDs without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: <T extends ArrayBufferView | null>(values: T) => {
        if (!(values instanceof Uint8Array)) {
          throw new Error("Expected a Uint8Array.");
        }
        values.set(Array.from({ length: 16 }, (_, index) => index));
        return values;
      },
    });
    const socket = new FakeSocket();
    const transport = createWebSocketTransport({
      createSocket: () => socket as unknown as WebSocket,
    });
    transport.activate();
    socket.open();

    transport.subscribeResource({
      onError: () => {},
      onInvalidate: () => {},
      resourceName: "resource",
    });

    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      operationId: "00010203-0405-4607-8809-0a0b0c0d0e0f",
      subscriptionId: "00010203-0405-4607-8809-0a0b0c0d0e0f",
    });
  });

  it("does not connect before activation", () => {
    const createSocket = vi.fn(() => new FakeSocket() as unknown as WebSocket);
    const transport = createWebSocketTransport({ createSocket });

    transport.subscribeLifecycle(() => {});

    expect(createSocket).not.toHaveBeenCalled();
    transport.activate();
    expect(createSocket).toHaveBeenCalledOnce();
  });

  it("reports connection status through reconnection", async () => {
    vi.useFakeTimers();
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const sockets = [firstSocket, secondSocket];
    const transport = createWebSocketTransport({
      createSocket: () => sockets.shift() as unknown as WebSocket,
    });
    const listener = vi.fn();
    transport.subscribeStatus(listener);

    transport.activate();
    firstSocket.open();
    firstSocket.close();
    await vi.advanceTimersByTimeAsync(250);
    secondSocket.open();

    expect(listener).toHaveBeenNthCalledWith(1, "disconnected");
    expect(listener).toHaveBeenNthCalledWith(2, "connecting");
    expect(listener).toHaveBeenNthCalledWith(3, "connected");
    expect(listener).toHaveBeenNthCalledWith(4, "disconnected");
    expect(listener).toHaveBeenNthCalledWith(5, "connecting");
    expect(listener).toHaveBeenNthCalledWith(6, "connected");
  });

  it("discovers identity before traffic and rediscovers on reconnect", async () => {
    vi.useFakeTimers();
    const first = new FakeSocket();
    const second = new FakeSocket();
    const sockets = [first, second];
    const transport = createWebSocketTransport({
      createSocket: () => sockets.shift() as unknown as WebSocket,
    });
    const listener = vi.fn();
    transport.subscribeInstance(listener);
    transport.activate();
    first.open("");
    expect(transport.getInstance()).toBeUndefined();
    await expect(
      transport.readResource({ resourceName: "ready" }),
    ).rejects.toThrow("disconnected");
    expect(first.sent).toEqual([]);

    first.receive({ type: "server-info", instanceId: "rich-work-1234" });
    expect(transport.getInstance()).toEqual({
      instanceId: "rich-work-1234",
      deepLinkPrefix: "overmux://rich-work-1234",
    });
    first.close();
    expect(transport.getInstance()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(250);
    second.open("rich-work-5678");
    expect(transport.getInstance()?.instanceId).toBe("rich-work-5678");
    expect(listener).toHaveBeenCalledTimes(3);
    transport.dispose();
  });

  it("reports authentication closure without reconnecting", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const createSocket = vi.fn(() => socket as unknown as WebSocket);
    const transport = createWebSocketTransport({ createSocket });
    const listener = vi.fn();
    transport.subscribeStatus(listener);
    transport.activate();
    socket.open();

    socket.serverClose(4001);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(listener).toHaveBeenLastCalledWith("authentication-required");
    expect(createSocket).toHaveBeenCalledOnce();
  });

  it("buffers client diagnostics until the socket opens", () => {
    const socket = new FakeSocket();
    const transport = createWebSocketTransport({
      createSocket: () => socket as unknown as WebSocket,
    });
    transport.reportDiagnostic({
      arguments: '["early"]',
      level: "info",
      message: "early",
      timestamp: "2026-03-09T12:00:00.000Z",
      type: "client-diagnostic",
    });

    transport.activate();
    expect(socket.sent).toHaveLength(0);
    socket.open();

    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      message: "early",
      type: "client-diagnostic",
    });
  });

  it("rejects an in-flight resource read when the connection closes", async () => {
    const socket = new FakeSocket();
    const transport = createWebSocketTransport({
      createSocket: () => socket as unknown as WebSocket,
    });
    transport.activate();
    socket.open();

    const read = transport.readResource({ resourceName: "resource" });
    socket.close();

    await expect(read).rejects.toThrow("disconnected");
  });

  it("delivers update and restart lifecycle events", () => {
    const socket = new FakeSocket();
    const transport = createWebSocketTransport({
      createSocket: () => socket as unknown as WebSocket,
    });
    const listener = vi.fn();
    transport.subscribeLifecycle(listener);
    transport.activate();
    socket.open();

    socket.receive({ type: "update-available" });
    socket.receive({ type: "restarting" });

    expect(listener.mock.calls.map(([message]) => message.type)).toEqual([
      "update-available",
      "restarting",
    ]);
  });

  testCases.each([
    { name: "socket still connecting", socketOpen: false },
    { name: "socket already open", socketOpen: true },
  ])(
    "queues stream messages until acknowledgement: $name",
    async ({ socketOpen }) => {
      const socket = new FakeSocket();
      const transport = createWebSocketTransport({
        createSocket: () => socket as unknown as WebSocket,
      });
      const onOpen = vi.fn();
      const onError = vi.fn();
      transport.activate();
      if (socketOpen) {
        socket.open();
      }
      const stream = transport.openStream({
        onClose: () => {},
        onError,
        onMessage: () => {},
        onOpen,
        streamName: "terminal",
      });
      expect(stream.send({ cols: 80, kind: "resize", rows: 24 })).toBe(true);
      await Promise.resolve();
      expect(stream.send({ data: "input", kind: "input" })).toBe(true);
      await Promise.resolve();
      expect(onError).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
      expect(socket.sent).toHaveLength(socketOpen ? 1 : 0);
      if (!socketOpen) {
        socket.open();
      }
      expect(socket.sent).toHaveLength(1);
      expect(onOpen).not.toHaveBeenCalled();
      const opened = JSON.parse(socket.sent[0] ?? "{}") as { streamId: string };

      socket.receive({
        operationId: opened.streamId,
        streamId: opened.streamId,
        type: "stream-opened",
      });

      expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
        expect.objectContaining({ type: "stream-open" }),
        expect.objectContaining({
          message: { cols: 80, kind: "resize", rows: 24 },
          type: "stream-message",
        }),
        expect.objectContaining({
          message: { data: "input", kind: "input" },
          type: "stream-message",
        }),
      ]);
      expect(onOpen).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
      socket.receive({
        operationId: opened.streamId,
        streamId: opened.streamId,
        type: "stream-opened",
      });
      expect(socket.sent).toHaveLength(3);
      expect(onOpen).toHaveBeenCalledOnce();
      transport.dispose();
    },
  );

  testCases.each(["inactive", "disposed", "backpressure", "disconnected"])(
    "rejects stream opening on %s rather than treating every failed send as connecting",
    (state) => {
      vi.useFakeTimers();
      const socket = new FakeSocket();
      const transport = createWebSocketTransport({
        createSocket: () => socket as unknown as WebSocket,
      });
      if (state !== "inactive") {
        transport.activate();
      }
      if (state === "disposed") {
        transport.dispose();
      }
      if (state === "backpressure") {
        socket.open();
        socket.bufferedAmount = 1_048_577;
      }
      if (state === "disconnected") {
        socket.close();
      }
      const onError = vi.fn();
      const onOpen = vi.fn();
      const stream = transport.openStream({
        onClose: () => {},
        onError,
        onMessage: () => {},
        onOpen,
        streamName: "terminal",
      });

      expect(onError).toHaveBeenCalledWith(
        new Error("Overmux transport disconnected."),
      );
      expect(stream.send({ kind: "not-queued" })).toBe(false);
      expect(onOpen).not.toHaveBeenCalled();
      expect(socket.send).not.toHaveBeenCalled();
      transport.dispose();
    },
  );

  it("discards queued stream messages when opening fails", () => {
    const socket = new FakeSocket();
    const transport = createWebSocketTransport({
      createSocket: () => socket as unknown as WebSocket,
    });
    const onClose = vi.fn();
    const onError = vi.fn();
    transport.activate();
    socket.open();
    const stream = transport.openStream({
      onClose,
      onError,
      onMessage: () => {},
      onOpen: () => {},
      streamName: "missing-terminal",
    });
    const opened = JSON.parse(socket.sent[0] ?? "{}") as { streamId: string };
    stream.send({ kind: "queued" });

    socket.receive({
      code: "not-found",
      message: "Stream not found",
      operationId: opened.streamId,
      type: "error",
    });
    socket.receive({
      operationId: opened.streamId,
      streamId: opened.streamId,
      type: "stream-opened",
    });

    expect(onError).toHaveBeenCalledWith(new Error("Stream not found"));
    expect(stream.send({ kind: "later" })).toBe(false);
    expect(socket.sent).toHaveLength(1);
    stream.close();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("discards queued stream messages when closed before opening", () => {
    const socket = new FakeSocket();
    const transport = createWebSocketTransport({
      createSocket: () => socket as unknown as WebSocket,
    });
    const onClose = vi.fn();
    transport.activate();
    socket.open();
    const stream = transport.openStream({
      onClose,
      onError: () => {},
      onMessage: () => {},
      onOpen: () => {},
      streamName: "terminal",
    });
    const opened = JSON.parse(socket.sent[0] ?? "{}") as { streamId: string };
    stream.send({ kind: "queued" });

    stream.close();
    socket.receive({
      operationId: opened.streamId,
      streamId: opened.streamId,
      type: "stream-opened",
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(stream.send({ kind: "later" })).toBe(false);
    expect(socket.sent.map((message) => JSON.parse(message).type)).toEqual([
      "stream-open",
      "stream-close",
    ]);
  });

  it("refetches resource subscriptions after reconnecting", async () => {
    vi.useFakeTimers();
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const sockets = [firstSocket, secondSocket];
    const transport = createWebSocketTransport({
      createSocket: () => sockets.shift() as unknown as WebSocket,
    });
    const onInvalidate = vi.fn();
    transport.activate();
    firstSocket.open();
    transport.subscribeResource({
      onError: () => {},
      onInvalidate,
      resourceName: "resource",
    });

    firstSocket.close();
    await vi.advanceTimersByTimeAsync(250);
    secondSocket.open();

    expect(onInvalidate).toHaveBeenCalledOnce();
    expect(JSON.parse(secondSocket.sent[0] ?? "{}")).toMatchObject({
      resourceName: "resource",
      type: "resource-subscribe",
    });
  });

  testCases.each([false, true])(
    "drops messages on real disconnect and only flushes restored messages (socket initially open: %s)",
    async (socketOpen) => {
      vi.useFakeTimers();
      const firstSocket = new FakeSocket();
      const secondSocket = new FakeSocket();
      const sockets = [firstSocket, secondSocket];
      const transport = createWebSocketTransport({
        createSocket: () => sockets.shift() as unknown as WebSocket,
      });
      const onError = vi.fn();
      transport.activate();
      if (socketOpen) {
        firstSocket.open();
      }
      const stream = transport.openStream({
        onClose: () => {},
        onError,
        onMessage: () => {},
        onOpen: () => {},
        streamName: "terminal",
      });
      stream.send({ kind: "before-disconnect" });

      firstSocket.close();
      expect(onError).toHaveBeenCalledExactlyOnceWith(
        new Error("Overmux transport disconnected."),
      );
      expect(stream.send({ kind: "while-disconnected" })).toBe(false);
      await vi.advanceTimersByTimeAsync(250);
      secondSocket.open();
      const restored = JSON.parse(secondSocket.sent[0] ?? "{}") as {
        streamId: string;
      };
      expect(stream.send({ kind: "after-reconnect" })).toBe(true);
      firstSocket.receive({
        operationId: restored.streamId,
        streamId: restored.streamId,
        type: "stream-opened",
      });
      expect(secondSocket.sent).toHaveLength(1);

      secondSocket.receive({
        operationId: restored.streamId,
        streamId: restored.streamId,
        type: "stream-opened",
      });

      expect(secondSocket.sent.map((message) => JSON.parse(message))).toEqual([
        expect.objectContaining({
          streamName: "terminal",
          type: "stream-open",
        }),
        expect.objectContaining({
          message: { kind: "after-reconnect" },
          type: "stream-message",
        }),
      ]);
    },
  );

  it("delivers validated notification events and unsubscribes listeners", () => {
    const socket = new FakeSocket();
    const transport = createWebSocketTransport({
      createSocket: () => socket as unknown as WebSocket,
    });
    const listener = vi.fn();
    const unsubscribe = transport.subscribeNotification(listener);
    transport.activate();
    socket.open();

    socket.receive({
      notification: { title: "done" },
      type: "notification",
    });
    unsubscribe();
    socket.receive({
      notification: { title: "again" },
      type: "notification",
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      notification: { title: "done" },
      type: "notification",
    });
  });

  it("delivers decoded Uint8Array stream frames", () => {
    const socket = new FakeSocket();
    const transport = createWebSocketTransport({
      createSocket: () => socket as unknown as WebSocket,
    });
    const onMessage = vi.fn();
    transport.activate();
    socket.open();
    transport.openStream({
      input: { paneId: "%1" },
      onClose: () => {},
      onError: () => {},
      onMessage,
      onOpen: () => {},
      streamName: "terminal",
    });
    const open = JSON.parse(socket.sent[0] ?? "{}") as { streamId: string };

    socket.receive({
      message: { bytes: new Uint8Array([65]), kind: "snapshot", sequence: 0 },
      streamId: open.streamId,
      type: "stream-output",
    });

    expect(onMessage.mock.calls[0]?.[0]).toMatchObject({
      bytes: new Uint8Array([65]),
    });
  });
});
