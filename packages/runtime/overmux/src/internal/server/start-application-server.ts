// Starts one immutable application runtime inside the supervised child process.
// It owns config loading, transport, and the listening socket.

import { serve, type ServerType as NodeServer } from "@hono/node-server";
import {
  loadOvermuxConfig,
  type RuntimeConfigDefinition,
} from "@overmux/shared/node";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { createAuthService, type AuthService } from "./auth/auth-service";
import {
  createAuthBoundary,
  validateAuthOrigin,
  type AuthBoundary,
} from "./auth/auth-http";
import { startInstanceControl } from "./auth/instance-control";
import { createHttpApp } from "./http/create-http-app";
import { createWebSocketServer } from "./websocket-server";
import {
  createBackgroundNotificationService,
  type BackgroundNotificationService,
} from "./notifications/background-notification-service";
import { createFileBackgroundNotificationStore } from "./notifications/background-notification-store";
import { createNotificationService } from "./notifications/notification-service";
import { createRuntime, type Runtime } from "./runtime/create-runtime";
import {
  createServerLogger,
  errorDetails,
  getServerLogFile,
  type ServerLogger,
} from "./server-logger";
import {
  resolveServerStartupOptions,
  type ResolvedServerStartupOptions,
} from "./server-startup-options";
import type { OvermuxServerOptions } from "./start-overmux-server";

type ResourceCleanup = () => void | Promise<void>;
type ServerResources = ReturnType<typeof createResources>;
type NotificationService = ReturnType<typeof createNotificationService>;
type StartApplicationServerOptions = {
  onRestartRequested: () => void;
  options: OvermuxServerOptions;
};

export type ApplicationServer = {
  announceUpdateAvailable: () => void;
  close: () => Promise<void>;
  host: string;
  port: number;
  url: string;
  watch: boolean;
};

const cleanupResources = async (cleanups: ResourceCleanup[]) => {
  const errors: unknown[] = [];
  for (const cleanup of [...cleanups].reverse()) {
    try {
      await cleanup();
    } catch (cause) {
      errors.push(cause);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to clean up server resources");
  }
};

const createResources = () => {
  const cleanups: ResourceCleanup[] = [];
  let closePromise: Promise<void> | undefined;
  return {
    add: (cleanup: ResourceCleanup) => cleanups.push(cleanup),
    close: () => {
      const next = closePromise ?? cleanupResources(cleanups);
      closePromise = next;
      return next;
    },
  };
};

const closeNodeServer = (
  server: NodeServer,
  cancelActiveWork: () => Promise<void>,
): Promise<void> => {
  const closed = new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (
        error &&
        (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
      ) {
        reject(error);
        return;
      }
      resolveClose();
    });
  });
  const cancellation = cancelActiveWork();
  if ("closeAllConnections" in server) {
    server.closeAllConnections();
  }
  return Promise.all([closed, cancellation]).then(() => undefined);
};

const getServerAddress = async (server: NodeServer): Promise<AddressInfo> => {
  if (!server.address()) {
    await once(server, "listening");
  }
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Overmux server did not bind a TCP address");
  }
  return address;
};

const registerProcessErrorLogging = (logger: ServerLogger) => {
  const onUncaughtException = (
    cause: Error,
    origin: "uncaughtException" | "unhandledRejection",
  ) =>
    logger.log({
      details: errorDetails(cause),
      event:
        origin === "unhandledRejection"
          ? "unhandled-rejection"
          : "uncaught-exception",
      level: "error",
    });
  process.on("uncaughtExceptionMonitor", onUncaughtException);
  return () => {
    process.off("uncaughtExceptionMonitor", onUncaughtException);
  };
};

const loadServerSettings = async ({
  configPath,
  options,
}: {
  configPath: string;
  options: OvermuxServerOptions;
}) => {
  const { config } = await loadOvermuxConfig({
    aliases: options.configAliases,
    configPath,
  });
  const startup = resolveServerStartupOptions({
    config,
    configPath,
    overrides: options,
  });
  return { config, startup };
};

const createAuthOrigins = ({
  configuredOrigins,
  startup,
}: {
  configuredOrigins?: string[];
  startup: ResolvedServerStartupOptions;
}) => {
  const urlHost = startup.host.includes(":")
    ? `[${startup.host}]`
    : startup.host;
  let values = (configuredOrigins ?? [`http://${urlHost}:${startup.port}`]).map(
    validateAuthOrigin,
  );
  return {
    establish: (localUrl: string) => {
      values = (configuredOrigins ?? [localUrl]).map(validateAuthOrigin);
      return values;
    },
    get: () => values,
  };
};

const createApplicationServices = async ({
  config,
  logger,
  resources,
  startup,
}: {
  config: RuntimeConfigDefinition;
  logger: ServerLogger;
  resources: ServerResources;
  startup: ResolvedServerStartupOptions;
}) => {
  // Browser origins are fixed from trusted startup data, never discovered from
  // requests. Ephemeral listener ports are finalized after binding.
  const authOrigins = createAuthOrigins({
    configuredOrigins: config.auth.origins,
    startup,
  });
  const authService = createAuthService({ config: config.auth });
  const auth = createAuthBoundary({
    origins: authOrigins.get,
    service: authService,
    trustedProxyPeer: config.auth.trustedProxyPeer,
  });
  const backgroundNotifications = createBackgroundNotificationService({
    isSessionActive: authService.isSessionActive,
    logger,
    store: createFileBackgroundNotificationStore(),
  });
  // Background subscriptions belong to browser sessions, so revocation also
  // removes delivery credentials owned by those sessions.
  resources.add(
    authService.onSessionsRevoked((sessionIds) => {
      void backgroundNotifications
        .disableSessions(sessionIds)
        .catch((cause: unknown) => {
          logger.log({
            details: errorDetails(cause),
            event: "background-notification-session-cleanup-failed",
            level: "error",
          });
        });
    }),
  );
  const notifications = createNotificationService({
    backgroundNotifications,
    logger,
  });
  const runtime = await createRuntime({
    config,
    debug: logger.enabled,
    notifications,
  });
  resources.add(runtime.dispose);
  return {
    auth,
    authOrigins,
    authService,
    backgroundNotifications,
    notifications,
    runtime,
  };
};

const startApplicationTransport = async ({
  auth,
  authOrigins,
  authService,
  backgroundNotifications,
  developmentWebTarget,
  logger,
  notifications,
  onRestartRequested,
  resources,
  runtime,
  startup,
}: {
  auth: AuthBoundary;
  authOrigins: ReturnType<typeof createAuthOrigins>;
  authService: AuthService;
  backgroundNotifications: BackgroundNotificationService;
  developmentWebTarget?: string;
  logger: ServerLogger;
  notifications: NotificationService;
  onRestartRequested: () => void;
  resources: ServerResources;
  runtime: Runtime;
  startup: ResolvedServerStartupOptions;
}) => {
  let announceRestarting: () => void = () => undefined;
  const app = createHttpApp({
    auth,
    backgroundNotifications,
    developmentWebTarget,
    onRestartRequested: () => {
      announceRestarting();
      onRestartRequested();
    },
    runtime,
    serverLogger: logger,
    webAssetsDir: developmentWebTarget
      ? undefined
      : startup.productionWebAssetsDir,
  });
  // Binding allocates the actual port. Reject early HTTP traffic until identity
  // and trusted origins are established; WebSocket upgrades attach only after that.
  let ready = false;
  const server = serve({
    fetch: (request, env) =>
      ready
        ? app.fetch(request, env)
        : new Response("Starting", { status: 503 }),
    hostname: startup.host,
    port: startup.port,
  });
  resources.add(() => closeNodeServer(server, runtime.dispose));
  const address = await getServerAddress(server);
  runtime.establishInstance(address.port);
  const urlHost = startup.host.includes(":")
    ? `[${startup.host}]`
    : startup.host;
  const localUrl = `http://${urlHost}:${address.port}`;
  const controlApiHost =
    startup.host === "0.0.0.0"
      ? "127.0.0.1"
      : startup.host === "::"
        ? "[::1]"
        : urlHost;
  const origins = authOrigins.establish(localUrl);
  authService.setOrigins(origins);
  const webSockets = createWebSocketServer({
    auth,
    developmentWebTarget,
    runtime,
    server,
    serverLogger: logger,
  });
  resources.add(webSockets.close);
  announceRestarting = webSockets.announceRestarting;
  notifications.attachLiveDelivery(webSockets.broadcastNotification);
  ready = true;
  const instanceControl = await startInstanceControl({
    auth: authService,
    apiUrl: `http://${controlApiHost}:${address.port}`,
    instanceId: runtime.instance.getInstanceId(),
    port: address.port,
    url: origins[0]!,
  });
  resources.add(instanceControl.close);
  return { address, app, localUrl, webSockets };
};

const closeApplicationServer = async ({
  app,
  logger,
  resources,
}: {
  app: ReturnType<typeof createHttpApp>;
  logger: ServerLogger;
  resources: ServerResources;
}) => {
  logger.log({ event: "server-stop" });
  app.beginShutdown();
  await resources.close();
};

const failApplicationServerStartup = async (
  cause: unknown,
  resources: ServerResources,
): Promise<never> => {
  try {
    await resources.close();
  } catch (cleanupCause) {
    throw new AggregateError(
      [cause, cleanupCause],
      "Server startup and cleanup failed",
    );
  }
  throw cause;
};

export const startApplicationServer = async ({
  onRestartRequested,
  options,
}: StartApplicationServerOptions): Promise<ApplicationServer> => {
  const logger = createServerLogger({
    enabled: options.debug ?? true,
    logFile: getServerLogFile(),
  });
  const resources = createResources();
  resources.add(registerProcessErrorLogging(logger));

  try {
    const configPath = resolve(options.configPath);
    logger.log({ details: { configPath }, event: "server-start" });
    const { config, startup } = await loadServerSettings({
      configPath,
      options,
    });
    logger.setEnabled(startup.debug);
    const {
      auth,
      authOrigins,
      authService,
      backgroundNotifications,
      notifications,
      runtime,
    } = await createApplicationServices({
      config,
      logger,
      resources,
      startup,
    });
    const { address, app, localUrl, webSockets } =
      await startApplicationTransport({
        auth,
        authOrigins,
        authService,
        backgroundNotifications,
        developmentWebTarget: options.developmentWebTarget,
        logger,
        notifications,
        onRestartRequested,
        resources,
        runtime,
        startup,
      });

    return {
      announceUpdateAvailable: webSockets.announceUpdateAvailable,
      close: () => closeApplicationServer({ app, logger, resources }),
      host: startup.host,
      port: address.port,
      url: localUrl,
      watch: startup.watch,
    };
  } catch (cause) {
    return failApplicationServerStartup(cause, resources);
  }
};
