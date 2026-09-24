import type { ServerType as NodeServer } from "@hono/node-server";
import {
  encodeProtocolFrame,
  notificationEventSchema,
  serverProtocolMessageSchema,
  webSocketCloseCode,
  type ServerProtocolMessage,
} from "../shared/index";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import { runtimeWebSocketPath, viteHmrPath } from "../shared/routes";
import { attachWebSocketConnection } from "./websocket-connection";
import type { AuthBoundary, RequestSession } from "./auth/auth-http";
import {
  errorDetails as diagnosticErrorDetails,
  type ServerLogger,
} from "./server-logger";
import type { Runtime } from "./runtime/create-runtime";
import { createViteWebSocketProxy } from "./vite-websocket-proxy";
import { maxWebSocketBufferedBytes } from "./websocket-limits";

const maxWebSocketPayloadBytes = 1_048_576;

// Upgrade requests bypass Hono routing, so rejected paths need a raw HTTP response.
const rejectUpgrade = (socket: Duplex, status: number, message: string) => {
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
};

const requestPath = (request: IncomingMessage) => {
  try {
    return new URL(request.url ?? "", "http://localhost").pathname;
  } catch {
    return undefined;
  }
};

const requestAuthenticationInput = (request: IncomingMessage) => {
  const host = request.headers.host;
  if (!host) {
    return;
  }
  const headers = new Headers();
  Object.entries(request.headers).forEach(([name, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(name, entry));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  });
  const encrypted = Boolean(
    (request.socket as typeof request.socket & { encrypted?: boolean })
      .encrypted,
  );
  try {
    return new Request(
      `${encrypted ? "https" : "http"}://${host}${request.url ?? "/"}`,
      { headers },
    );
  } catch {
    return;
  }
};

// Tie a WebSocket to its session, periodically revalidating it and cleaning up
// the session mapping when the connection closes.
export const attachSessionLifecycle = ({
  auth,
  serverLogger,
  session,
  sessionSockets,
  socket,
}: {
  auth: AuthBoundary;
  serverLogger?: ServerLogger;
  session: RequestSession;
  sessionSockets: Map<WebSocket, string>;
  socket: WebSocket;
}) => {
  sessionSockets.set(socket, session.id);
  let revalidationPending = false;
  const revalidationTimer = setInterval(() => {
    if (revalidationPending) {
      return;
    }
    revalidationPending = true;
    void auth.service
      .authenticateToken(session.token, session.origin)
      .then(
        (authenticated) => {
          if (!authenticated) {
            socket.close(
              webSocketCloseCode.authenticationRevoked,
              "authentication revoked",
            );
          }
        },
        (cause: unknown) => {
          serverLogger?.log({
            details: diagnosticErrorDetails(cause),
            event: "websocket-session-revalidation-failure",
            level: "error",
          });
          socket.close(
            webSocketCloseCode.authenticationUnavailable,
            "authentication unavailable",
          );
        },
      )
      .finally(() => {
        revalidationPending = false;
      });
  }, 1_000);
  socket.once("close", () => {
    clearInterval(revalidationTimer);
    sessionSockets.delete(socket);
  });
};

// WebSocket upgrades bypass Hono but share its credential parser. Browser
// sessions additionally require the exact canonical Origin; local bearer clients
// are not browser-origin credentials. Each socket remains tied to its session so
// explicit revocation closes it immediately, while periodic revalidation covers
// expiration and changes made by another server process.
export const createWebSocketServer = ({
  auth,
  developmentWebTarget,
  runtime,
  server,
  serverLogger,
}: {
  auth: AuthBoundary;
  developmentWebTarget?: string;
  runtime: Runtime;
  server: NodeServer;
  serverLogger?: ServerLogger;
}) => {
  const webSocketServer = new WebSocketServer({
    maxPayload: maxWebSocketPayloadBytes,
    noServer: true,
  });
  let updateAvailable = false;
  const sessionSockets = new Map<WebSocket, string>();
  const viteProxy = developmentWebTarget
    ? createViteWebSocketProxy({
        auth,
        serverLogger,
        target: developmentWebTarget,
      })
    : undefined;
  const removeRevocationListener = auth.service.onSessionsRevoked((ids) => {
    sessionSockets.forEach((sessionId, socket) => {
      if (ids.has(sessionId)) {
        socket.close(
          webSocketCloseCode.authenticationRevoked,
          "authentication revoked",
        );
      }
    });
    viteProxy?.revoke(ids);
  });
  const onUpgrade = async (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    const correlationId = serverLogger?.id();
    serverLogger?.log({ correlationId, event: "websocket-connect" });
    const path = requestPath(request);
    const isRuntimeSocket = path === runtimeWebSocketPath;
    const isViteSocket =
      path === viteHmrPath && developmentWebTarget !== undefined;
    if (!isRuntimeSocket && !isViteSocket) {
      serverLogger?.log({
        correlationId,
        details: { status: 404 },
        event: "websocket-connect-rejected",
        level: "warn",
      });
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    const authenticationInput = requestAuthenticationInput(request);
    if (!authenticationInput) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    const origin = auth.resolveOrigin({
      remoteAddress: request.socket.remoteAddress,
      request: authenticationInput,
    });
    let session: RequestSession | undefined;
    try {
      session = await auth.requests.authenticate(authenticationInput, origin);
    } catch (cause) {
      serverLogger?.log({
        correlationId,
        details: diagnosticErrorDetails(cause),
        event: "websocket-authentication-failure",
        level: "error",
      });
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    if (!session) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    if (
      session.kind === "browser" &&
      (!origin || request.headers.origin !== origin)
    ) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    if (isViteSocket) {
      if (
        session.kind !== "browser" ||
        session.credential !== "cookie" ||
        !origin
      ) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      if (!viteProxy) {
        rejectUpgrade(socket, 503, "Service Unavailable");
        return;
      }
      viteProxy.connect({
        correlationId,
        head,
        origin,
        request,
        session,
        socket,
      });
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      attachSessionLifecycle({
        auth,
        serverLogger,
        session,
        sessionSockets,
        socket: webSocket,
      });
      // Discovery precedes all connection traffic, including sticky announcements.
      webSocket.send(
        encodeProtocolFrame({
          type: "server-info",
          instanceId: runtime.instance.getInstanceId(),
        }),
      );
      webSocketServer.emit("connection", webSocket, request);
      attachWebSocketConnection({ runtime, serverLogger, socket: webSocket });
      if (updateAvailable) {
        webSocket.send(encodeProtocolFrame({ type: "update-available" }));
      }
    });
  };
  server.on("upgrade", onUpgrade);

  const broadcast = (message: ServerProtocolMessage) => {
    const frame = encodeProtocolFrame(
      serverProtocolMessageSchema.parse(message),
    );
    let delivered = 0;
    webSocketServer.clients.forEach((socket) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      // Apply outbound backpressure by dropping slow clients before queued broadcasts consume unbounded memory.
      if (socket.bufferedAmount > maxWebSocketBufferedBytes) {
        socket.close(1013, "client could not keep up");
        return;
      }
      try {
        socket.send(frame);
        delivered += 1;
      } catch (cause) {
        socket.terminate();
        serverLogger?.log({
          details: diagnosticErrorDetails(cause),
          event: "websocket-broadcast-failure",
          level: "error",
        });
      }
    });
    return delivered;
  };

  return {
    announceRestarting: () => broadcast({ type: "restarting" }),
    announceUpdateAvailable: () => {
      updateAvailable = true;
      return broadcast({ type: "update-available" });
    },
    broadcastNotification: (notification: unknown) =>
      broadcast(
        notificationEventSchema.parse({
          notification,
          type: "notification",
        }),
      ),
    close: async () => {
      server.off("upgrade", onUpgrade);
      removeRevocationListener();
      viteProxy?.close();
      webSocketServer.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve) =>
        webSocketServer.close(() => resolve()),
      );
    },
  };
};
