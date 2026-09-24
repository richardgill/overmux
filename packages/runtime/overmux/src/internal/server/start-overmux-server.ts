import type { ServerConfigDefinition } from "../../public/index";
import { resolve } from "node:path";

import { startServerCoordinator } from "./coordinator/server-coordinator";

export type OvermuxServerOptions = ServerConfigDefinition & {
  configAliases?: Record<string, string>;
  debug?: boolean;
  developmentWebTarget?: string;
  configPath: string;
};

export type OvermuxServer = {
  announceUpdateAvailable: () => void;
  close: () => Promise<void>;
  port: number;
  url: string;
};

export const startOvermuxServer = async (
  options: OvermuxServerOptions,
): Promise<OvermuxServer> =>
  startServerCoordinator({
    ...options,
    configPath: resolve(options.configPath),
  });
