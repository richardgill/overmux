// Provides server health and acknowledged restart control endpoints.
// Shutdown state is shared with the HTTP app composition root.
import type { HttpBindings } from "@hono/node-server";
import type { Handler } from "hono";

import type { AuthEnvironment } from "../auth/auth-http";

export type ShutdownState = { requested: boolean };

export const createHealthHandler =
  ({ shutdown }: { shutdown: ShutdownState }): Handler<AuthEnvironment> =>
  (context) =>
    shutdown.requested
      ? context.json({ status: "stopping" }, 503)
      : context.json({ status: "ok" });

export const createRestartHandler =
  ({
    onRestartRequested,
    shutdown,
  }: {
    onRestartRequested?: () => void;
    shutdown: ShutdownState;
  }): Handler<AuthEnvironment> =>
  (context) => {
    const response = context.json({ status: "restarting" }, 202);
    if (!onRestartRequested) {
      return response;
    }
    const beginRestart = () => {
      shutdown.requested = true;
      onRestartRequested();
    };
    const nodeResponse = (context.env as Partial<HttpBindings> | undefined)
      ?.outgoing;
    if (nodeResponse) {
      // Flush the restart acknowledgement before replacing the server.
      nodeResponse.once("finish", beginRestart);
    } else {
      // In-memory Hono requests have no Node response, so defer past the handler.
      setImmediate(beginRestart);
    }
    return response;
  };
