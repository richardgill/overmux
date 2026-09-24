import { serveStatic } from "@hono/node-server/serve-static";
import type { Handler, Hono, MiddlewareHandler } from "hono";
import { join } from "node:path";

import {
  createHttpAuthenticationHandlers,
  type AuthBoundary,
  type AuthEnvironment,
} from "../auth/auth-http";
import type { BackgroundNotificationService } from "../notifications/background-notification-service";
import type { Runtime } from "../runtime/create-runtime";
import type { ServerLogger } from "../server-logger";
import { createBackgroundNotificationHandlers } from "./background-notification-handlers";
import { createDevelopmentWebHandler } from "./development-web-backend";
import {
  createHealthHandler,
  createRestartHandler,
  type ShutdownState,
} from "./control-handlers";
import { createOperationHandler } from "./operation-handler";
import { createRequestLoggingMiddleware } from "./request-logging";
import { createRuntimeManifestHandler } from "./runtime-manifest-handler";
import { overmuxLogoutPath, overmuxSettingsPath } from "@overmux/shared";
import { viteInfrastructurePath } from "../../shared/routes";

// Registration order is the public/protected boundary. Authentication state,
// login, and health are registered before the session gate; runtime APIs and
// static assets are registered after it. Keep every Hono route visible in this
// file for review.
type RouteDescriptor =
  | {
      method: "USE";
      path: string;
      handler: MiddlewareHandler<AuthEnvironment>;
    }
  | {
      method: "GET" | "POST" | "PUT" | "DELETE" | "ALL";
      path: string;
      handler: Handler<AuthEnvironment> | MiddlewareHandler<AuthEnvironment>;
      middleware?: MiddlewareHandler<AuthEnvironment>;
    };

type RegisterHttpRoutesOptions = {
  app: Hono<AuthEnvironment>;
  auth: AuthBoundary;
  authAssetsDirectory?: string;
  backgroundNotifications?: BackgroundNotificationService;
  developmentWebTarget?: string;
  onRestartRequested?: () => void;
  runtime: Runtime;
  serverLogger?: ServerLogger;
  shutdown: ShutdownState;
  webAssetsDir?: string;
};

const applyDescriptor = (
  app: Hono<AuthEnvironment>,
  route: RouteDescriptor,
) => {
  if (route.method === "USE") {
    app.use(route.path, route.handler);
    return;
  }
  if (route.middleware) {
    app.on(route.method, route.path, route.middleware, route.handler);
    return;
  }
  app.on(route.method, route.path, route.handler);
};

export const registerHttpRoutes = ({
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
}: RegisterHttpRoutesOptions) => {
  const authentication = createHttpAuthenticationHandlers({
    auth,
    authAssetsDirectory,
  });
  const notificationHandlers = backgroundNotifications
    ? createBackgroundNotificationHandlers({ backgroundNotifications })
    : undefined;
  const developmentWebHandler = developmentWebTarget
    ? createDevelopmentWebHandler({
        auth,
        serverLogger,
        target: developmentWebTarget,
      })
    : undefined;
  const productionWebHandler = webAssetsDir
    ? serveStatic({ path: join(webAssetsDir, "index.html") })
    : undefined;
  const hostedWebHandler = developmentWebHandler ?? productionWebHandler;
  const routes: RouteDescriptor[] = [
    {
      method: "USE",
      path: "*",
      handler: createRequestLoggingMiddleware({ serverLogger }),
    },
    // BEGIN: UNAUTHENTICATED
    {
      method: "GET",
      path: "/_overmux/auth-shell/*",
      handler: authentication.asset,
    },
    {
      method: "GET",
      path: "/api/auth/state",
      handler: authentication.state,
    },
    {
      method: "POST",
      path: "/api/auth/login",
      middleware: authentication.loginBodyLimitMiddleware,
      handler: authentication.login,
    },
    {
      method: "GET",
      path: "/login",
      handler: authentication.loginPage,
    },
    {
      method: "GET",
      path: "/api/health",
      handler: createHealthHandler({ shutdown }),
    },
    // END: UNAUTHENTICATED
    {
      method: "USE",
      path: "*",
      handler: authentication.authenticate,
    },
    // BEGIN: AUTHENTICATED
    {
      method: "POST",
      path: "/api/auth/logout",
      handler: authentication.logout,
    },
    {
      method: "POST",
      path: "/api/operations/:name",
      handler: createOperationHandler({ runtime, serverLogger }),
    },
    {
      method: "POST",
      path: "/api/restart",
      handler: createRestartHandler({ onRestartRequested, shutdown }),
    },
    {
      method: "GET",
      path: "/api/runtime-manifest",
      handler: createRuntimeManifestHandler({ runtime }),
    },
    ...(notificationHandlers
      ? [
          {
            method: "GET" as const,
            path: "/api/background-notifications/public-key",
            handler: notificationHandlers.publicKey,
          },
          {
            method: "PUT" as const,
            path: "/api/background-notifications/subscription",
            handler: notificationHandlers.enable,
          },
          {
            method: "DELETE" as const,
            path: "/api/background-notifications/subscription",
            handler: notificationHandlers.disable,
          },
        ]
      : []),
    {
      method: "ALL",
      path: "/api/*",
      handler: (context) => context.notFound(),
    },
    ...(developmentWebHandler
      ? [
          {
            method: "ALL" as const,
            path: viteInfrastructurePath,
            handler: developmentWebHandler,
          },
        ]
      : []),
    ...(hostedWebHandler
      ? [
          {
            method: "GET" as const,
            path: overmuxSettingsPath,
            handler: hostedWebHandler,
          },
          {
            method: "GET" as const,
            path: overmuxLogoutPath,
            handler: hostedWebHandler,
          },
        ]
      : []),
    {
      method: "ALL",
      path: "/_overmux/*",
      handler: (context) => context.notFound(),
    },
    ...(developmentWebHandler
      ? [
          {
            method: "ALL" as const,
            path: "*",
            handler: developmentWebHandler,
          },
        ]
      : []),
    ...(webAssetsDir
      ? [
          {
            method: "USE" as const,
            path: "*",
            handler: serveStatic({ root: webAssetsDir }),
          },
          // Serve the SPA shell for client-side routes that do not match a static asset.
          {
            method: "GET" as const,
            path: "*",
            handler: serveStatic({ path: join(webAssetsDir, "index.html") }),
          },
        ]
      : []),
    // END: AUTHENTICATED
  ];

  routes.forEach((route) => applyDescriptor(app, route));
};
