import {
  clientProtocolMessageSchema,
  createInstanceIdentity,
  type InstanceIdentity,
  decodeProtocolFrame,
  encodeProtocolMessage,
  serverProtocolMessageSchema,
  streamMessageSchema,
  webSocketCloseCode,
  type ClientDiagnosticEvent,
  type ClientProtocolMessage,
  type ServerLifecycleEvent,
} from "../shared/index";

type Request = {
  reject: (error: Error) => void;
  resolve: (output: unknown) => void;
};
type Subscription = {
  input: unknown;
  onError: (error: Error) => void;
  onInvalidate: () => void;
  resourceName: string;
};
type StreamMessage = Extract<ClientProtocolMessage, { type: "stream-message" }>;

type Stream = {
  input: unknown;
  onOpen: () => void;
  onClose: () => void;
  onError: (error: Error) => void;
  onMessage: (message: unknown) => void;
  pendingMessages: StreamMessage[];
  status: "disconnected" | "failed" | "open" | "opening";
  streamName: string;
};

const maxWebSocketBufferedBytes = 1_048_576;

export type TransportStatus =
  | "authentication-required"
  | "connecting"
  | "connected"
  | "disconnected";

export type WebSocketTransport = {
  getInstance: () => InstanceIdentity | undefined;
  subscribeInstance: (listener: () => void) => () => void;
  activate: () => void;
  dispose: () => void;
  openStream: (input: {
    input?: unknown;
    onClose: () => void;
    onError: (error: Error) => void;
    onOpen: () => void;
    onMessage: (message: unknown) => void;
    streamName: string;
  }) => { close: () => void; send: (message: unknown) => boolean };
  readResource: (input: {
    input?: unknown;
    resourceName: string;
  }) => Promise<unknown>;
  reportDiagnostic: (event: ClientDiagnosticEvent) => void;
  subscribeResource: (input: {
    input?: unknown;
    onError: (error: Error) => void;
    onInvalidate: () => void;
    resourceName: string;
  }) => () => void;
  subscribeStatus: (listener: (status: TransportStatus) => void) => () => void;
  subscribeLifecycle: (
    listener: (event: ServerLifecycleEvent) => void,
  ) => () => void;
  subscribeNotification: (listener: (event: unknown) => void) => () => void;
};

const socketUrl = () =>
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/socket`;

const operationId = () => {
  const randomUUID = crypto.randomUUID?.();
  if (randomUUID) {
    return randomUUID;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const disconnected = () => new Error("Overmux transport disconnected.");

export const createWebSocketTransport = ({
  createSocket = () => new WebSocket(socketUrl()),
}: {
  createSocket?: () => WebSocket;
} = {}): WebSocketTransport => {
  let active = false;
  let disposed = false;
  let reconnectDelay = 250;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  let status: TransportStatus = "disconnected";
  let instance: InstanceIdentity | undefined;
  const instanceListeners = new Set<() => void>();
  const setInstance = (next: InstanceIdentity | undefined) => {
    instance = next;
    instanceListeners.forEach((listener) => listener());
  };
  const diagnosticQueue: ClientDiagnosticEvent[] = [];
  const requests = new Map<string, Request>();
  const subscriptions = new Map<string, Subscription>();
  const streams = new Map<string, Stream>();
  const lifecycleListeners = new Set<(event: ServerLifecycleEvent) => void>();
  const notificationListeners = new Set<(event: unknown) => void>();
  const statusListeners = new Set<(status: TransportStatus) => void>();

  const setStatus = (next: TransportStatus) => {
    if (status === next) {
      return;
    }
    status = next;
    statusListeners.forEach((listener) => listener(status));
  };
  const send = (message: unknown) => {
    if (socket?.readyState !== WebSocket.OPEN || !instance) {
      return false;
    }
    // Apply outbound backpressure before queued messages consume unbounded memory.
    if (socket.bufferedAmount > maxWebSocketBufferedBytes) {
      socket.close(1013, "client could not keep up");
      return false;
    }
    socket.send(
      encodeProtocolMessage(clientProtocolMessageSchema.parse(message)),
    );
    return true;
  };
  const flushDiagnostics = () => {
    const unsent = diagnosticQueue.filter((event) => !send(event));
    diagnosticQueue.splice(0, diagnosticQueue.length, ...unsent);
  };
  const request = ({
    input,
    resourceName,
  }: {
    input?: unknown;
    resourceName: string;
  }) =>
    new Promise<unknown>((resolve, reject) => {
      const id = operationId();
      requests.set(id, { reject, resolve });
      const message = {
        input,
        operationId: id,
        resourceName,
        type: "resource-read",
      };
      if (!send(message)) {
        requests.delete(id);
        reject(disconnected());
      }
    });
  const restore = () => {
    subscriptions.forEach(
      ({ input, onInvalidate, resourceName }, subscriptionId) => {
        if (
          send({
            input,
            operationId: subscriptionId,
            resourceName,
            subscriptionId,
            type: "resource-subscribe",
          })
        ) {
          onInvalidate();
        }
      },
    );
    streams.forEach((stream, streamId) => {
      if (stream.status === "failed") {
        return;
      }
      stream.status = send({
        input: stream.input,
        operationId: streamId,
        streamId,
        streamName: stream.streamName,
        type: "stream-open",
      })
        ? "opening"
        : "disconnected";
    });
  };
  const rejectRequests = (error: Error) => {
    requests.forEach(({ reject }) => reject(error));
    requests.clear();
  };
  const reportDisconnect = () => {
    setInstance(undefined);
    const error = disconnected();
    rejectRequests(error);
    subscriptions.forEach(({ onError }) => onError(error));
    streams.forEach((stream) => {
      stream.pendingMessages.length = 0;
      if (stream.status !== "failed") {
        stream.status = "disconnected";
      }
      stream.onError(error);
    });
  };
  const connect = () => {
    if (!active || disposed || socket) {
      return;
    }
    setStatus("connecting");
    const next = createSocket();
    next.binaryType = "arraybuffer";
    socket = next;
    next.addEventListener("message", (event) => {
      if (socket !== next || disposed) {
        return;
      }
      let decoded: unknown;
      try {
        decoded = decodeProtocolFrame(event.data as string | ArrayBuffer);
      } catch (cause) {
        reportDisconnect();
        console.error("Invalid Overmux transport message", cause);
        next.close(1002, "invalid protocol message");
        return;
      }
      const parsed = serverProtocolMessageSchema.safeParse(decoded);
      if (!parsed.success) {
        reportDisconnect();
        console.error("Invalid Overmux transport message", parsed.error);
        next.close(1002, "invalid protocol message");
        return;
      }
      const message = parsed.data;
      if (message.type === "server-info" && !instance) {
        setInstance(createInstanceIdentity(message.instanceId));
        reconnectDelay = 250;
        setStatus("connected");
        flushDiagnostics();
        restore();
        return;
      }
      if (!instance || message.type === "server-info") {
        reportDisconnect();
        next.close(1002, "expected server discovery before traffic");
        return;
      }
      if (
        message.type === "update-available" ||
        message.type === "restarting"
      ) {
        lifecycleListeners.forEach((listener) => listener(message));
      }
      if (message.type === "notification") {
        notificationListeners.forEach((listener) => listener(message));
      }
      if (message.type === "resource-invalidated") {
        subscriptions.get(message.subscriptionId)?.onInvalidate();
      }
      if (message.type === "stream-opened") {
        const stream = streams.get(message.streamId);
        if (stream?.status === "opening") {
          stream.status = "open";
          const pendingMessages = stream.pendingMessages.splice(0);
          if (pendingMessages.every(send)) {
            stream.onOpen();
          }
        }
      }
      if (message.type === "stream-output") {
        streams.get(message.streamId)?.onMessage(message.message);
      }
      if (message.type === "stream-closed") {
        const stream = streams.get(message.streamId);
        if (stream) {
          stream.pendingMessages.length = 0;
          stream.onClose();
          streams.delete(message.streamId);
        }
      }
      if (message.type === "error") {
        if (message.operationId) {
          requests.get(message.operationId)?.reject(new Error(message.message));
        }
        const stream = streams.get(message.operationId ?? "");
        if (stream) {
          stream.pendingMessages.length = 0;
          stream.status = "failed";
          stream.onError(new Error(message.message));
        }
        subscriptions
          .get(message.operationId ?? "")
          ?.onError(new Error(message.message));
        requests.delete(message.operationId ?? "");
      }
      if (message.type === "resource-result") {
        requests.get(message.operationId)?.resolve(message.output);
        requests.delete(message.operationId);
      }
    });
    next.addEventListener("close", (event) => {
      if (socket !== next || disposed) {
        return;
      }
      socket = undefined;
      reportDisconnect();
      if (event.code === webSocketCloseCode.authenticationRevoked) {
        active = false;
        setStatus("authentication-required");
        return;
      }
      setStatus("disconnected");
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 5_000);
    });
  };

  return {
    getInstance: () => instance,
    subscribeInstance: (listener) => {
      instanceListeners.add(listener);
      return () => instanceListeners.delete(listener);
    },
    activate: () => {
      active = true;
      connect();
    },
    dispose: () => {
      disposed = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
      }
      reportDisconnect();
      streams.forEach(({ onClose }) => onClose());
      streams.clear();
      subscriptions.clear();
      socket?.close();
    },
    openStream: ({
      input,
      onClose,
      onError,
      onMessage,
      onOpen,
      streamName,
    }) => {
      if (!active || disposed) {
        onError(disconnected());
        return { close: () => {}, send: () => false };
      }
      const streamId = operationId();
      const stream: Stream = {
        input,
        onClose,
        onError,
        onMessage,
        onOpen,
        pendingMessages: [],
        status: "disconnected",
        streamName,
      };
      streams.set(streamId, stream);
      // Initial connection is not a failure: restore sends stream-open when the socket
      // opens, then stream-opened flushes queued messages. Actual failures still reject.
      stream.status =
        status === "connecting" ||
        send({
          input,
          operationId: streamId,
          streamId,
          streamName,
          type: "stream-open",
        })
          ? "opening"
          : "disconnected";
      if (stream.status === "disconnected") {
        onError(disconnected());
      }
      return {
        close: () => {
          const activeStream = streams.get(streamId);
          if (activeStream) {
            activeStream.pendingMessages.length = 0;
            activeStream.onClose();
            streams.delete(streamId);
          }
          send({ streamId, type: "stream-close" });
        },
        send: (message) => {
          const activeStream = streams.get(streamId);
          if (
            activeStream?.status !== "open" &&
            activeStream?.status !== "opening"
          ) {
            return false;
          }
          const protocolMessage = streamMessageSchema.parse({
            message,
            streamId,
            type: "stream-message",
          });
          if (activeStream.status === "opening") {
            activeStream.pendingMessages.push(protocolMessage);
            return true;
          }
          return send(protocolMessage);
        },
      };
    },
    readResource: (input) => request(input),
    reportDiagnostic: (event) => {
      if (send(event)) {
        return;
      }
      diagnosticQueue.push(event);
      if (diagnosticQueue.length > 100) {
        diagnosticQueue.shift();
      }
    },
    subscribeResource: ({ input, onError, onInvalidate, resourceName }) => {
      const subscriptionId = operationId();
      subscriptions.set(subscriptionId, {
        input,
        onError,
        onInvalidate,
        resourceName,
      });
      if (
        !send({
          input,
          operationId: subscriptionId,
          resourceName,
          subscriptionId,
          type: "resource-subscribe",
        })
      ) {
        onError(disconnected());
      }
      return () => {
        subscriptions.delete(subscriptionId);
        send({ subscriptionId, type: "resource-unsubscribe" });
      };
    },
    subscribeStatus: (listener) => {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    subscribeLifecycle: (listener) => {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },
    subscribeNotification: (listener) => {
      notificationListeners.add(listener);
      return () => notificationListeners.delete(listener);
    },
  };
};
