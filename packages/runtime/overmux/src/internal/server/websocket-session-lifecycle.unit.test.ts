import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { webSocketCloseCode } from "../shared/index";
import type { AuthBoundary } from "./auth/auth-http";
import { attachSessionLifecycle } from "./websocket-server";

const createSocket = () =>
  Object.assign(new EventEmitter(), { close: vi.fn() }) as unknown as WebSocket;

const createAuth = (authenticateToken: () => Promise<undefined>) =>
  ({ service: { authenticateToken } }) as unknown as AuthBoundary;

const session = {
  credential: "bearer",
  id: "session-id",
  kind: "local",
  token: "session-token",
} as const;

afterEach(() => vi.useRealTimers());

describe("WebSocket session lifecycle", () => {
  it("closes with the revoked authentication code when revalidation rejects a token", async () => {
    vi.useFakeTimers();
    const socket = createSocket();
    attachSessionLifecycle({
      auth: createAuth(async () => undefined),
      session,
      sessionSockets: new Map(),
      socket,
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(socket.close).toHaveBeenCalledWith(
      webSocketCloseCode.authenticationRevoked,
      "authentication revoked",
    );
    socket.emit("close");
  });

  it("closes with the retryable code when authentication revalidation fails", async () => {
    vi.useFakeTimers();
    const socket = createSocket();
    attachSessionLifecycle({
      auth: createAuth(async () => Promise.reject(new Error("unavailable"))),
      session,
      sessionSockets: new Map(),
      socket,
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(socket.close).toHaveBeenCalledWith(
      webSocketCloseCode.authenticationUnavailable,
      "authentication unavailable",
    );
    socket.emit("close");
  });
});
