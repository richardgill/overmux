// Owns protocol and lifecycle state for one WebSocket connection.
// Independent resource, stream, notification, diagnostics, and lifecycle traffic shares it.
import {
  clientProtocolMessageSchema,
  decodeProtocolFrame,
  encodeProtocolFrame,
  serverProtocolMessageSchema,
  type ClientProtocolMessage,
  type ServerProtocolMessage,
} from "../shared/index";
import { WebSocket, type RawData } from "ws";
import { ZodError } from "zod";

import {
  errorDetails as diagnosticErrorDetails,
  type ServerLogger,
} from "./server-logger";
import type { Runtime } from "./runtime/create-runtime";
import type { RuntimeStreamSession } from "./runtime/runtime-streams";
import { maxWebSocketBufferedBytes } from "./websocket-limits";

const maxPendingStreamOutputBytes = 1_048_576;

type ErrorCode = "bad-request" | "conflict" | "internal" | "not-found";

type SubscriptionEntry = {
  controller: AbortController;
  dispose?: () => Promise<void> | void;
};

type OperationIdentity = {
  operationId: string;
  operationType: string;
  requestedName?: string;
};

type StreamEntry = {
  controller: AbortController;
  identity: OperationIdentity;
  session?: RuntimeStreamSession;
};

type ConnectionState = {
  closed: boolean;
  connectionId?: string;
  operations: Map<string, AbortController>;
  runtime: Runtime;
  serverLogger?: ServerLogger;
  socket: WebSocket;
  streams: Map<string, StreamEntry>;
  subscriptions: Map<string, SubscriptionEntry>;
};

class OperationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const bytesOf = (data: RawData) => {
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

const textOf = (data: RawData) => Buffer.from(bytesOf(data)).toString("utf8");

const frameLength = (message: unknown) => {
  const frame = encodeProtocolFrame(message);
  return typeof frame === "string"
    ? Buffer.byteLength(frame, "utf8")
    : frame.byteLength;
};

const operationIdOf = (value: unknown) => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const operationId = (value as Record<string, unknown>).operationId;
  return typeof operationId === "string" && operationId.length <= 256
    ? operationId
    : undefined;
};

const errorDetails = (cause: unknown): { code: ErrorCode; message: string } => {
  if (cause instanceof OperationError) {
    return { code: cause.code, message: cause.message };
  }
  if (cause instanceof ZodError || cause instanceof SyntaxError) {
    return {
      code: "bad-request",
      message:
        cause instanceof ZodError
          ? cause.issues
              .map(
                (issue) =>
                  `${issue.path.join(".") || "value"}: ${issue.message}`,
              )
              .join("; ")
          : cause.message,
    };
  }
  return {
    code: "internal",
    message: cause instanceof Error ? cause.message : String(cause),
  };
};

const send = (state: ConnectionState, message: ServerProtocolMessage) => {
  if (state.closed || state.socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  // Apply outbound backpressure before queued messages consume unbounded memory.
  if (state.socket.bufferedAmount > maxWebSocketBufferedBytes) {
    state.socket.close(1013, "client could not keep up");
    return false;
  }
  state.socket.send(
    encodeProtocolFrame(serverProtocolMessageSchema.parse(message)),
  );
  return true;
};

const sendError = (
  state: ConnectionState,
  cause: unknown,
  operationId?: string,
  identity?: OperationIdentity,
) => {
  const error = errorDetails(cause);
  state.serverLogger?.log({
    correlationId: identity?.operationId ?? operationId ?? state.connectionId,
    details: {
      code: error.code,
      ...identity,
      ...diagnosticErrorDetails(cause),
    },
    event: "protocol-handler-error",
    level: "error",
  });
  send(state, { ...error, operationId, type: "error" });
};

const disposeSubscription = async (
  state: ConnectionState,
  subscriptionId: string,
) => {
  const entry = state.subscriptions.get(subscriptionId);
  if (!entry) {
    return;
  }
  state.subscriptions.delete(subscriptionId);
  entry.controller.abort(new Error("Resource subscription closed"));
  await entry.dispose?.();
};

const disposeStream = async (
  state: ConnectionState,
  streamId: string,
  notify = true,
) => {
  const entry = state.streams.get(streamId);
  if (!entry) {
    if (notify) {
      send(state, { streamId, type: "stream-closed" });
    }
    return;
  }
  state.streams.delete(streamId);
  entry.controller.abort(new Error("Stream closed"));
  await entry.session?.dispose();
  if (notify) {
    send(state, { streamId, type: "stream-closed" });
  }
};

const disposeConnectionOperations = async (
  state: ConnectionState,
  notify: boolean,
) => {
  const operationControllers = [...state.operations.values()];
  state.operations.clear();
  operationControllers.forEach((controller) =>
    controller.abort(new Error("WebSocket connection closed")),
  );
  const subscriptionIds = [...state.subscriptions.keys()];
  const streamIds = [...state.streams.keys()];
  await Promise.allSettled([
    ...subscriptionIds.map((subscriptionId) =>
      disposeSubscription(state, subscriptionId),
    ),
    ...streamIds.map((streamId) => disposeStream(state, streamId, notify)),
  ]);
};

const runOperation = (
  state: ConnectionState,
  identity: OperationIdentity,
  operation: (signal: AbortSignal) => Promise<void>,
) => {
  if (state.operations.has(identity.operationId)) {
    sendError(
      state,
      new OperationError("conflict", "Operation ID is already active"),
      identity.operationId,
      identity,
    );
    return;
  }
  const controller = new AbortController();
  const startedAt = Date.now();
  state.operations.set(identity.operationId, controller);
  state.serverLogger?.log({
    correlationId: identity.operationId,
    details: identity,
    event: "operation-start",
  });
  void operation(controller.signal)
    .then(() => {
      state.serverLogger?.log({
        correlationId: identity.operationId,
        details: identity,
        durationMs: Date.now() - startedAt,
        event: "operation-complete",
      });
    })
    .catch((cause: unknown) => {
      if (!controller.signal.aborted && !state.closed) {
        state.serverLogger?.log({
          correlationId: identity.operationId,
          details: { ...identity, ...diagnosticErrorDetails(cause) },
          durationMs: Date.now() - startedAt,
          event: "operation-error",
          level: "error",
        });
        sendError(state, cause, identity.operationId, identity);
      }
    })
    .finally(() => {
      if (state.operations.get(identity.operationId) === controller) {
        state.operations.delete(identity.operationId);
      }
    });
};

const readResource = (
  state: ConnectionState,
  message: Extract<ClientProtocolMessage, { type: "resource-read" }>,
) => {
  const resource = state.runtime.getResource(message.resourceName);
  const identity: OperationIdentity = {
    operationId: message.operationId,
    operationType: message.type,
    requestedName: message.resourceName,
  };
  runOperation(state, identity, async (signal) => {
    if (!resource) {
      throw new OperationError("not-found", "Resource not found");
    }
    const output = await resource.read(message.input, signal);
    send(state, {
      operationId: message.operationId,
      output,
      type: "resource-result",
    });
  });
};

const subscribeResource = (
  state: ConnectionState,
  message: Extract<ClientProtocolMessage, { type: "resource-subscribe" }>,
) => {
  const resource = state.runtime.getResource(message.resourceName);
  const identity: OperationIdentity = {
    operationId: message.operationId,
    operationType: message.type,
    requestedName: message.resourceName,
  };
  if (state.subscriptions.has(message.subscriptionId)) {
    sendError(
      state,
      new OperationError("conflict", "Subscription ID is already active"),
      message.operationId,
      identity,
    );
    return;
  }
  runOperation(state, identity, async (operationSignal) => {
    if (!resource) {
      throw new OperationError("not-found", "Resource not found");
    }
    const controller = new AbortController();
    const entry: SubscriptionEntry = { controller };
    state.subscriptions.set(message.subscriptionId, entry);
    const signal = AbortSignal.any([operationSignal, controller.signal]);
    try {
      entry.dispose = resource.subscribe(
        message.input,
        () =>
          void send(state, {
            subscriptionId: message.subscriptionId,
            type: "resource-invalidated",
          }),
        signal,
      );
    } catch (cause) {
      await disposeSubscription(state, message.subscriptionId);
      throw cause;
    }
  });
};

const openStream = (
  state: ConnectionState,
  message: Extract<ClientProtocolMessage, { type: "stream-open" }>,
) => {
  const stream = state.runtime.getStream(message.streamName);
  const identity: OperationIdentity = {
    operationId: message.operationId,
    operationType: message.type,
    requestedName: message.streamName,
  };
  if (state.streams.has(message.streamId)) {
    sendError(
      state,
      new OperationError("conflict", "Stream ID is already active"),
      message.operationId,
      identity,
    );
    return;
  }
  runOperation(state, identity, async (operationSignal) => {
    if (!stream) {
      throw new OperationError("not-found", "Stream not found");
    }
    const controller = new AbortController();
    const entry: StreamEntry = { controller, identity };
    state.streams.set(message.streamId, entry);
    const pending: unknown[] = [];
    let pendingBytes = 0;
    let opened = false;
    try {
      entry.session = await stream.open(
        message.input,
        (output) => {
          if (opened) {
            const sent = send(state, {
              message: output,
              streamId: message.streamId,
              type: "stream-output",
            });
            if (!sent) {
              throw new Error("Stream output could not be delivered");
            }
            return;
          }
          pendingBytes += frameLength(output);
          if (pendingBytes > maxPendingStreamOutputBytes) {
            throw new Error("Stream produced too much output while opening");
          }
          pending.push(output);
        },
        AbortSignal.any([operationSignal, controller.signal]),
        (cause) => {
          sendError(state, cause, message.streamId, identity);
          void disposeStream(state, message.streamId).catch(
            (disposeCause: unknown) => {
              sendError(state, disposeCause, message.streamId, identity);
            },
          );
        },
      );
      send(state, {
        operationId: message.operationId,
        streamId: message.streamId,
        type: "stream-opened",
      });
      opened = true;
      for (const output of pending) {
        if (
          !send(state, {
            message: output,
            streamId: message.streamId,
            type: "stream-output",
          })
        ) {
          throw new Error("Stream output could not be delivered");
        }
      }
    } catch (cause) {
      await disposeStream(state, message.streamId, false);
      throw cause;
    }
  });
};

const sendStreamMessage = (
  state: ConnectionState,
  message: Extract<ClientProtocolMessage, { type: "stream-message" }>,
) => {
  const entry = state.streams.get(message.streamId);
  const identity: OperationIdentity = {
    ...entry?.identity,
    operationId: message.streamId,
    operationType: message.type,
  };
  if (!entry?.session) {
    sendError(
      state,
      new OperationError("not-found", "Stream not found"),
      message.streamId,
      identity,
    );
    return;
  }
  void entry.session.send(message.message).catch((cause: unknown) => {
    sendError(state, cause, message.streamId, identity);
    void disposeStream(state, message.streamId).catch(
      (disposeCause: unknown) => {
        sendError(state, disposeCause, message.streamId, identity);
      },
    );
  });
};

const logClientDiagnostic = (
  state: ConnectionState,
  message: Extract<ClientProtocolMessage, { type: "client-diagnostic" }>,
) => {
  if (!state.serverLogger?.enabled) {
    return;
  }
  state.serverLogger.log({
    details: {
      arguments: message.arguments,
      ...(message.stack ? { stack: message.stack } : {}),
      ...(message.url ? { url: message.url } : {}),
    },
    event: "browser-console",
    level: message.level === "log" ? "info" : message.level,
    message: message.message,
    source: "browser",
    timestamp: message.timestamp,
  });
};

const handleMessage = (
  state: ConnectionState,
  message: ClientProtocolMessage,
) => {
  if (message.type === "client-diagnostic") {
    logClientDiagnostic(state, message);
    return;
  }
  if (message.type === "resource-read") {
    readResource(state, message);
    return;
  }
  if (message.type === "resource-subscribe") {
    subscribeResource(state, message);
    return;
  }
  if (message.type === "resource-unsubscribe") {
    void disposeSubscription(state, message.subscriptionId).catch(
      (cause: unknown) => {
        sendError(state, cause, message.subscriptionId);
      },
    );
    return;
  }
  if (message.type === "stream-open") {
    openStream(state, message);
    return;
  }
  if (message.type === "stream-close") {
    void disposeStream(state, message.streamId).catch((cause: unknown) => {
      sendError(state, cause, message.streamId);
    });
    return;
  }
  sendStreamMessage(state, message);
};

const handleFrame = (
  state: ConnectionState,
  data: RawData,
  isBinary: boolean,
) => {
  let raw: unknown;
  try {
    raw = decodeProtocolFrame(isBinary ? bytesOf(data) : textOf(data));
    const result = clientProtocolMessageSchema.safeParse(raw);
    if (!result.success) {
      state.serverLogger?.log({
        correlationId: state.connectionId,
        details: diagnosticErrorDetails(result.error),
        event: "protocol-parse-error",
        level: "error",
      });
      sendError(state, result.error, operationIdOf(raw));
      return;
    }
    handleMessage(state, result.data);
  } catch (cause) {
    state.serverLogger?.log({
      correlationId: state.connectionId,
      details: diagnosticErrorDetails(cause),
      event: "protocol-parse-error",
      level: "error",
    });
    sendError(state, cause, operationIdOf(raw));
  }
};

const disposeConnection = async (state: ConnectionState) => {
  if (state.closed) {
    return;
  }
  state.closed = true;
  state.serverLogger?.log({
    correlationId: state.connectionId,
    event: "websocket-close",
  });
  await disposeConnectionOperations(state, false);
};

const createConnectionState = ({
  runtime,
  serverLogger,
  socket,
}: {
  runtime: Runtime;
  serverLogger?: ServerLogger;
  socket: WebSocket;
}): ConnectionState => ({
  closed: false,
  connectionId: serverLogger?.id(),
  operations: new Map(),
  runtime,
  serverLogger,
  socket,
  streams: new Map(),
  subscriptions: new Map(),
});

export const attachWebSocketConnection = ({
  runtime,
  serverLogger,
  socket,
}: {
  runtime: Runtime;
  serverLogger?: ServerLogger;
  socket: WebSocket;
}) => {
  const state = createConnectionState({ runtime, serverLogger, socket });
  serverLogger?.log({
    correlationId: state.connectionId,
    event: "websocket-open",
  });
  socket.on("message", (data, isBinary) => handleFrame(state, data, isBinary));
  socket.once("close", (code, reason) => {
    serverLogger?.log({
      correlationId: state.connectionId,
      details: { code, reason: reason?.toString() ?? "" },
      event: "websocket-close-event",
    });
    void disposeConnection(state);
  });
  socket.once("error", (cause) => {
    serverLogger?.log({
      correlationId: state.connectionId,
      details: diagnosticErrorDetails(cause),
      event: "websocket-error",
      level: "error",
    });
    void disposeConnection(state);
  });
  return () => disposeConnection(state);
};
