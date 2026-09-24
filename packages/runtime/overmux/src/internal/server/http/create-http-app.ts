import { Hono } from "hono";

import type { AuthBoundary, AuthEnvironment } from "../auth/auth-http";
import type { BackgroundNotificationService } from "../notifications/background-notification-service";
import type { ServerLogger } from "../server-logger";
import type { Runtime } from "../runtime/create-runtime";
import { registerHttpRoutes } from "./routes";

export type HttpAppOptions = {
  auth: AuthBoundary;
  authAssetsDirectory?: string;
  backgroundNotifications?: BackgroundNotificationService;
  developmentWebTarget?: string;
  onRestartRequested?: () => void;
  serverLogger?: ServerLogger;
  runtime: Runtime;
  webAssetsDir?: string;
};

export const createHttpApp = ({
  auth,
  authAssetsDirectory,
  backgroundNotifications,
  developmentWebTarget,
  onRestartRequested,
  serverLogger,
  runtime,
  webAssetsDir,
}: HttpAppOptions) => {
  const app = new Hono<AuthEnvironment>();
  const shutdown = { requested: false };

  registerHttpRoutes({
    app,
    auth,
    authAssetsDirectory,
    backgroundNotifications,
    developmentWebTarget,
    onRestartRequested,
    runtime,
    serverLogger,
    shutdown,
    webAssetsDir,
  });

  return Object.assign(app, {
    beginShutdown: () => {
      shutdown.requested = true;
    },
  });
};

export type OvermuxHttpApp = ReturnType<typeof createHttpApp>;
