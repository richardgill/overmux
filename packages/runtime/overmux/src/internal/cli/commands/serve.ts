import { loadOvermuxConfig } from "@overmux/shared/node";
import { buildCommand } from "@stricli/core";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { CliCommandContext, CliEnvironment } from "../environment";
import { issueLoginGrant, printLoginFallback, printLoginGrant } from "../login";
import {
  loadViteRoot,
  startManagedVite,
  watchTrustedFiles,
  type ViteApi,
} from "../managed-vite";
import { parsePort } from "../parse-port";
import { startOvermuxServer } from "../../server/index";
import { getDefaultConfigPath } from "../../server/paths";

export type ServeFlags = {
  config: string;
  host?: string;
  login?: boolean;
  noBuild?: boolean;
  noLogin?: boolean;
  port?: number;
  production?: boolean;
};

export type RunningServe = {
  close: () => Promise<void>;
  port: number;
  url: string;
};

const loadApplicationVite = async (
  viteConfigPath: string,
): Promise<ViteApi> => {
  const require = createRequire(viteConfigPath);
  const viteEntry = require.resolve("vite");
  return import(pathToFileURL(viteEntry).href) as Promise<ViteApi>;
};

// Register before startup resolves so signals still clean up partially started servers.
const registerShutdown = (
  running: Promise<RunningServe>,
  process: NodeJS.Process,
) => {
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      const server = await running;
      await server.close();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  const onSignal = () => void shutdown();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
};

const startDevelopmentServer = async ({
  configPath,
  host,
  port,
  shouldWatch,
  vite,
  viteConfigPath,
}: {
  configPath: string;
  host?: string;
  port?: number;
  shouldWatch: boolean;
  vite: ViteApi;
  viteConfigPath: string;
}): Promise<RunningServe> => {
  const managedVite = await startManagedVite({
    api: vite,
    configPath: viteConfigPath,
  });
  let server: Awaited<ReturnType<typeof startOvermuxServer>> | undefined;
  let stopWatching: () => void = () => undefined;
  try {
    if (shouldWatch) {
      stopWatching = await watchTrustedFiles({
        configPath,
        onUpdate: () => server?.announceUpdateAvailable(),
        server: managedVite.server,
      });
    }
    server = await startOvermuxServer({
      configPath,
      developmentWebTarget: managedVite.target,
      ...(host === undefined ? {} : { host }),
      ...(port === undefined ? {} : { port }),
      watch: false,
    });
    return {
      close: async () => {
        stopWatching();
        await Promise.all([server?.close(), managedVite.close()]);
      },
      port: server.port,
      url: server.url,
    };
  } catch (cause) {
    stopWatching();
    await Promise.all([server?.close(), managedVite.close()]);
    throw cause;
  }
};

const startProductionServer = async ({
  configPath,
  host,
  noBuild,
  port,
  productionWebAssetsDir,
  vite,
  viteConfigPath,
}: {
  configPath: string;
  host?: string;
  noBuild: boolean;
  port?: number;
  productionWebAssetsDir: string;
  vite: ViteApi;
  viteConfigPath: string;
}): Promise<RunningServe> => {
  if (noBuild) {
    const entryPath = join(productionWebAssetsDir, "index.html");
    try {
      await access(entryPath);
    } catch {
      throw new Error(`Production entry does not exist: ${entryPath}`);
    }
  } else {
    const { root } = await loadViteRoot({
      api: vite,
      command: "build",
      configPath: viteConfigPath,
    });
    await vite.build({ configFile: viteConfigPath, root });
  }
  const server = await startOvermuxServer({
    configPath,
    ...(host === undefined ? {} : { host }),
    ...(port === undefined ? {} : { port }),
  });
  return { close: server.close, port: server.port, url: server.url };
};

export const resolveServeLogin = (
  flags: Pick<ServeFlags, "login" | "noLogin">,
  environment: Pick<CliEnvironment, "isHumanUser">,
) => {
  if (flags.login && flags.noLogin) {
    throw new Error("Only set one of: --login and --no-login");
  }
  return flags.login || (!flags.noLogin && environment.isHumanUser);
};

const announceServeLogin = async ({
  createLogin,
  port,
  process,
}: {
  createLogin: boolean;
  port: number;
  process: NodeJS.Process;
}) => {
  if (!createLogin) {
    printLoginFallback(port, process);
    return;
  }
  printLoginGrant({ ...(await issueLoginGrant(port)), output: process });
  process.stdout.write(
    `\nNeed another grant? Run \`overmux auth login --port ${port}\`.\n`,
  );
};

export const runServe = async ({
  environment,
  flags,
  process,
}: {
  environment: Pick<CliEnvironment, "isHumanUser">;
  flags: ServeFlags;
  process: NodeJS.Process;
}) => {
  if (flags.noBuild && !flags.production) {
    throw new Error("--no-build requires --production");
  }
  const createLogin = resolveServeLogin(flags, environment);
  const configPath = resolve(flags.config);
  const { config } = await loadOvermuxConfig({ configPath });
  if (!config.vite) {
    throw new Error("Overmux config must define a Vite config path in `vite`");
  }
  const viteConfigPath = resolve(dirname(configPath), config.vite);
  const vite = await loadApplicationVite(viteConfigPath);
  let runningPromise: Promise<RunningServe>;
  if (flags.production) {
    if (!config.productionWebAssetsDir) {
      throw new Error(
        "Overmux config must define `productionWebAssetsDir` for production serving",
      );
    }
    runningPromise = startProductionServer({
      configPath,
      host: flags.host,
      noBuild: flags.noBuild ?? false,
      port: flags.port,
      productionWebAssetsDir: resolve(
        dirname(configPath),
        config.productionWebAssetsDir,
      ),
      vite,
      viteConfigPath,
    });
  } else {
    runningPromise = startDevelopmentServer({
      configPath,
      host: flags.host,
      port: flags.port,
      shouldWatch: config.watch ?? true,
      vite,
      viteConfigPath,
    });
  }
  const unregisterShutdown = registerShutdown(runningPromise, process);
  let running: RunningServe | undefined;
  try {
    running = await runningPromise;
    process.stdout.write(
      `Overmux listening on ${config.auth.origins?.[0] ?? running.url}\n`,
    );
    await announceServeLogin({ createLogin, port: running.port, process });
  } catch (cause) {
    unregisterShutdown();
    await running?.close().catch(() => undefined);
    throw cause;
  }
};

function runServeCommand(this: CliCommandContext, flags: ServeFlags) {
  return runServe({
    environment: this.environment,
    flags,
    process: this.process,
  });
}

export const serveCommand = buildCommand({
  func: runServeCommand,
  parameters: {
    aliases: { c: "config" },
    flags: {
      config: {
        brief: "Configuration file",
        default: getDefaultConfigPath(),
        kind: "parsed",
        parse: String,
        placeholder: "path",
      },
      host: {
        brief: "Override the public listener host",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "host",
      },
      login: {
        brief: "Create a browser login grant after startup",
        kind: "boolean",
        optional: true,
        withNegated: false,
      },
      noBuild: {
        brief: "Serve existing production assets without building",
        kind: "boolean",
        optional: true,
      },
      noLogin: {
        brief: "Do not create a browser login grant after startup",
        kind: "boolean",
        optional: true,
        withNegated: false,
      },
      port: {
        brief: "Override the public listener port",
        kind: "parsed",
        optional: true,
        parse: (value) => {
          const port = parsePort(value);
          if (port instanceof Error) {
            throw port;
          }
          return port;
        },
        placeholder: "port",
      },
      production: {
        brief: "Build and serve the production web application",
        kind: "boolean",
        optional: true,
      },
    },
  },
  docs: {
    brief: "Serve the Overmux web application",
    fullDescription:
      "Starts private Vite behind the authenticated Overmux gateway, or builds and serves production assets with --production.",
  },
});
