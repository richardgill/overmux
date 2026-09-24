import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { proxyUpgrade } from "httpxy";

import { webSocketCloseCode } from "../shared/index";
import type { AuthBoundary, RequestSession } from "./auth/auth-http";
import {
  errorDetails as diagnosticErrorDetails,
  type ServerLogger,
} from "./server-logger";

type ProxiedSocket = {
  client: Duplex;
  closed: boolean;
  sessionId: string;
  timer: NodeJS.Timeout;
  upstream?: Socket;
};

const setTrustedForwardingHeaders = (
  request: IncomingMessage,
  origin: string,
) => {
  Object.keys(request.headers).forEach((name) => {
    if (
      name === "authorization" ||
      name === "cookie" ||
      name === "forwarded" ||
      name.startsWith("x-forwarded-")
    ) {
      Reflect.deleteProperty(request.headers, name);
    }
  });
  const publicUrl = new URL(origin);
  request.headers["x-forwarded-for"] = request.socket.remoteAddress;
  request.headers["x-forwarded-host"] = publicUrl.host;
  request.headers["x-forwarded-port"] =
    publicUrl.port || (publicUrl.protocol === "https:" ? "443" : "80");
  request.headers["x-forwarded-proto"] = publicUrl.protocol.slice(0, -1);
};

// httpxy preserves an established WebSocket as a raw tunnel, so gateway-owned
// revocation writes the server close frame before ending both sides.
const closeFrame = (code: number, reason: string) => {
  const payload = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
  payload.writeUInt16BE(code);
  payload.write(reason, 2);
  return Buffer.concat([Buffer.from([0x88, payload.length]), payload]);
};

const closeSocket = (socket: ProxiedSocket, code: number, reason: string) => {
  if (socket.closed) {
    return;
  }
  socket.closed = true;
  clearInterval(socket.timer);
  if (!socket.client.destroyed) {
    socket.client.end(closeFrame(code, reason));
  }
  socket.upstream?.destroy();
};

const revalidateSocket = async ({
  auth,
  serverLogger,
  origin,
  socket,
  token,
}: {
  auth: AuthBoundary;
  origin: string;
  serverLogger?: ServerLogger;
  socket: ProxiedSocket;
  token: string;
}) => {
  try {
    if (!(await auth.service.authenticateToken(token, origin))) {
      closeSocket(
        socket,
        webSocketCloseCode.authenticationRevoked,
        "authentication revoked",
      );
    }
  } catch (cause) {
    serverLogger?.log({
      details: diagnosticErrorDetails(cause),
      event: "vite-websocket-session-revalidation-failure",
      level: "error",
    });
    closeSocket(
      socket,
      webSocketCloseCode.authenticationUnavailable,
      "authentication unavailable",
    );
  }
};

export const createViteWebSocketProxy = ({
  auth,
  serverLogger,
  target,
}: {
  auth: AuthBoundary;
  serverLogger?: ServerLogger;
  target: string;
}) => {
  const sockets = new Map<Duplex, ProxiedSocket>();

  const connect = ({
    correlationId,
    head,
    origin,
    request,
    session,
    socket,
  }: {
    correlationId?: string;
    head: Buffer;
    origin: string;
    request: IncomingMessage;
    session: RequestSession;
    socket: Duplex;
  }) => {
    let revalidationPending = false;
    const proxied: ProxiedSocket = {
      client: socket,
      closed: false,
      sessionId: session.id,
      timer: setInterval(() => {
        if (revalidationPending) {
          return;
        }
        revalidationPending = true;
        void revalidateSocket({
          auth,
          origin,
          serverLogger,
          socket: proxied,
          token: session.token,
        }).finally(() => {
          revalidationPending = false;
        });
      }, 1_000),
    };
    sockets.set(socket, proxied);
    socket.once("close", () => {
      clearInterval(proxied.timer);
      sockets.delete(socket);
    });
    setTrustedForwardingHeaders(request, origin);
    void proxyUpgrade(target, request, socket, head, {
      changeOrigin: true,
      xfwd: false,
    }).then(
      (upstream) => {
        // Revocation can win while httpxy is opening the private side.
        if (proxied.closed) {
          upstream.destroy();
          return;
        }
        proxied.upstream = upstream;
      },
      (cause: unknown) => {
        clearInterval(proxied.timer);
        sockets.delete(socket);
        if (proxied.closed) {
          return;
        }
        proxied.closed = true;
        serverLogger?.log({
          correlationId,
          details: diagnosticErrorDetails(cause),
          event: "vite-websocket-proxy-failure",
          level: "error",
        });
      },
    );
  };

  return {
    close: () => {
      sockets.forEach((socket) =>
        closeSocket(socket, 1001, "server shutting down"),
      );
      sockets.clear();
    },
    connect,
    revoke: (ids: ReadonlySet<string>) => {
      sockets.forEach((socket) => {
        if (ids.has(socket.sessionId)) {
          closeSocket(
            socket,
            webSocketCloseCode.authenticationRevoked,
            "authentication revoked",
          );
        }
      });
    },
  };
};
