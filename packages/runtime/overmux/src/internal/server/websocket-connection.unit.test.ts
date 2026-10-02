import {
  serverDefinitionRuntimeSchema,
  type RuntimeConfigDefinition,
} from "@overmux/shared/node";
import { EventEmitter } from "node:events";
import { describe, expect, it, test as testCases, vi } from "vitest";
import { WebSocket } from "ws";
import { z } from "zod";

import {
  decodeProtocolFrame,
  encodeProtocolMessage,
  type ServerProtocolMessage,
} from "../shared/index";
import {
  defineOvermuxServer,
  defineResourceContract,
  type SubscriptionResourceDefinition,
} from "../../public/index";
import { createRuntime } from "./runtime/create-runtime";
import type { ServerLogger } from "./server-logger";
import { attachWebSocketConnection } from "./websocket-connection";
import { ProtocolError } from "./protocol-error";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (cause: unknown) => void;
  resolve: (value: T) => void;
};

type TestSocket = EventEmitter & {
  bufferedAmount: number;
  readyState: number;
  sent: ServerProtocolMessage[];
  send: (frame: string | Uint8Array) => void;
};

const deferred = <T>(): Deferred<T> => {
  let reject!: (cause: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

const createSocket = (): TestSocket => {
  const socket = new EventEmitter() as TestSocket;
  socket.bufferedAmount = 0;
  socket.readyState = WebSocket.OPEN;
  socket.sent = [];
  socket.send = (frame) => {
    socket.sent.push(decodeProtocolFrame(frame) as ServerProtocolMessage);
  };
  return socket;
};

type CountResource = SubscriptionResourceDefinition<
  typeof countContract.input,
  typeof countContract.output
>;

const attach = async ({
  subscribe,
  read = () => 1,
  serverLogger,
}: {
  subscribe: CountResource["subscribe"];
  read?: CountResource["read"];
  serverLogger?: ServerLogger;
}) => {
  const config: RuntimeConfigDefinition = {
    auth: { mode: "cli-login", sessionLifetime: "forever" },
    server: serverDefinitionRuntimeSchema.parse(
      defineOvermuxServer({
        resources: {
          count: {
            contract: countContract,
            kind: "subscription",
            read,
            subscribe,
          },
        },
      }),
    ),
  };
  const runtime = await createRuntime({ config });
  const socket = createSocket();
  attachWebSocketConnection({
    runtime,
    serverLogger,
    socket: socket as unknown as WebSocket,
  });
  return { runtime, socket };
};

const send = (socket: TestSocket, message: unknown) => {
  socket.emit("message", Buffer.from(encodeProtocolMessage(message)), false);
};

const subscription = ({
  operationId = "subscribe",
  subscriptionId = "one",
} = {}) => ({
  input: undefined,
  operationId,
  resourceName: "count",
  subscriptionId,
  type: "resource-subscribe" as const,
});

const countContract = defineResourceContract({
  input: z.void(),
  output: z.number(),
});

const errorCases = [
  {
    name: "typed protocol error",
    cause: new ProtocolError("conflict", "failed"),
    code: "conflict",
  },
  {
    name: "arbitrary protocol-like code",
    cause: Object.assign(new Error("failed"), { code: "bad-request" }),
    code: "internal",
  },
  {
    name: "native code",
    cause: Object.assign(new Error("failed"), { code: "ENOENT" }),
    code: "internal",
  },
];
testCases.each(errorCases)("WebSocket maps $name", async ({ cause, code }) => {
  const { runtime, socket } = await attach({
    subscribe: () => () => undefined,
    read: () => {
      throw cause;
    },
  });
  send(socket, {
    type: "resource-read",
    resourceName: "count",
    operationId: "read",
  });
  await vi.waitFor(() =>
    expect(socket.sent).toContainEqual({
      type: "error",
      operationId: "read",
      code,
      message: "failed",
    }),
  );
  socket.emit("close");
  await runtime.dispose();
});

describe("WebSocket resource subscriptions", () => {
  it("returns an async setup rejection to its subscription operation", async () => {
    const setup = deferred<() => void>();
    const started = deferred<void>();
    const { runtime, socket } = await attach({
      subscribe: () => {
        started.resolve();
        return setup.promise;
      },
    });

    send(socket, subscription());
    await started.promise;
    setup.reject(new Error("setup failed"));
    await vi.waitFor(() =>
      expect(socket.sent).toContainEqual({
        code: "internal",
        message: "setup failed",
        operationId: "subscribe",
        type: "error",
      }),
    );
    await runtime.dispose();
  });

  it("refreshes a subscription after setup when its value changed", async () => {
    const setup = deferred<() => void>();
    const started = deferred<void>();
    let value = 1;
    const { runtime, socket } = await attach({
      read: () => value,
      subscribe: () => {
        started.resolve();
        return setup.promise;
      },
    });

    send(socket, {
      input: undefined,
      operationId: "initial-read",
      resourceName: "count",
      type: "resource-read",
    });
    await vi.waitFor(() =>
      expect(socket.sent).toContainEqual({
        operationId: "initial-read",
        output: 1,
        type: "resource-result",
      }),
    );
    send(socket, subscription());
    await started.promise;
    value = 2;
    setup.resolve(() => undefined);
    await vi.waitFor(() =>
      expect(socket.sent).toContainEqual({
        subscriptionId: "one",
        type: "resource-invalidated",
      }),
    );

    send(socket, {
      input: undefined,
      operationId: "fresh-read",
      resourceName: "count",
      type: "resource-read",
    });
    await vi.waitFor(() =>
      expect(socket.sent).toContainEqual({
        operationId: "fresh-read",
        output: 2,
        type: "resource-result",
      }),
    );
    await runtime.dispose();
  });

  it("aborts pending setup on disconnect and releases its late cleanup once", async () => {
    const setup = deferred<() => void>();
    const aborted = deferred<void>();
    const cleanup = deferred<void>();
    const started = deferred<void>();
    let cleanupCalls = 0;
    const { runtime, socket } = await attach({
      subscribe: (_input, _invalidate, context) => {
        context.signal.addEventListener("abort", () => aborted.resolve(), {
          once: true,
        });
        started.resolve();
        return setup.promise;
      },
    });

    send(socket, subscription());
    await started.promise;
    socket.emit("close", 1000, Buffer.alloc(0));
    await aborted.promise;
    setup.resolve(() => {
      cleanupCalls += 1;
      cleanup.resolve();
    });
    await cleanup.promise;

    expect(cleanupCalls).toBe(1);
    expect(socket.sent).toEqual([]);
    await runtime.dispose();
  });

  const lateSettlements = [
    {
      name: "success",
      settle: (setup: Deferred<() => void>) => setup.resolve(() => undefined),
      expectsCancelledError: false,
    },
    {
      name: "rejection",
      settle: (setup: Deferred<() => void>) =>
        setup.reject(new Error("old setup failed")),
      expectsCancelledError: true,
    },
    {
      name: "cleanup failure",
      settle: (setup: Deferred<() => void>) =>
        setup.resolve(() => {
          throw new Error("old cleanup failed");
        }),
      expectsCancelledError: true,
    },
  ];

  testCases.each(lateSettlements)(
    "keeps a replacement usable after old setup $name",
    async ({ expectsCancelledError, settle }) => {
      const oldSetup = deferred<() => void>();
      const oldStarted = deferred<void>();
      const replacementCleanup = deferred<void>();
      const replacementSetup = deferred<() => void>();
      const replacementStarted = deferred<void>();
      const log = vi.fn<ServerLogger["log"]>();
      let replacementCleanupCalls = 0;
      let replacementInvalidate!: () => void;
      let subscribeCalls = 0;
      const { runtime, socket } = await attach({
        subscribe: (_input, invalidate) => {
          subscribeCalls += 1;
          if (subscribeCalls === 1) {
            oldStarted.resolve();
            return oldSetup.promise;
          }
          replacementInvalidate = invalidate;
          replacementStarted.resolve();
          return replacementSetup.promise;
        },
        serverLogger: { enabled: true, id: () => "connection", log },
      });

      send(socket, subscription({ operationId: "old" }));
      await oldStarted.promise;
      send(socket, { subscriptionId: "one", type: "resource-unsubscribe" });
      send(socket, subscription({ operationId: "replacement" }));
      await replacementStarted.promise;
      replacementSetup.resolve(() => {
        replacementCleanupCalls += 1;
        replacementCleanup.resolve();
      });
      await vi.waitFor(() =>
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "operation-complete",
            correlationId: "replacement",
          }),
        ),
      );
      const invalidation = {
        subscriptionId: "one",
        type: "resource-invalidated",
      };
      expect(socket.sent).toEqual([invalidation]);
      settle(oldSetup);
      await vi.waitFor(() =>
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "operation-complete",
            correlationId: "old",
          }),
        ),
      );

      expect(socket.sent).toEqual([invalidation]);
      expect(replacementCleanupCalls).toBe(0);
      expect(
        log.mock.calls.some(
          ([entry]) => entry.event === "resource-subscription-cancelled-error",
        ),
      ).toBe(expectsCancelledError);

      replacementInvalidate();
      await vi.waitFor(() =>
        expect(socket.sent).toEqual([invalidation, invalidation]),
      );
      send(socket, { subscriptionId: "one", type: "resource-unsubscribe" });
      await replacementCleanup.promise;
      expect(replacementCleanupCalls).toBe(1);
      await runtime.dispose();
    },
  );
});
