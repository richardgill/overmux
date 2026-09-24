import {
  getOvermuxPaths,
  type GetOvermuxPathsOptions,
} from "@overmux/shared/node";
import { createJiti } from "jiti";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  desktopConfigRuntimeSchema,
  type DesktopConfig,
} from "../config/schema.js";

export type { DesktopConfig } from "../config/schema.js";

type DesktopConfigPathOptions = {
  arguments_?: readonly string[];
  paths?: GetOvermuxPathsOptions;
};

type LoadDesktopConfigOptions = {
  configApiPath?: string;
  configPath: string;
};

const unwrapDefaultExport = (module: unknown) => {
  if (typeof module === "object" && module !== null && "default" in module) {
    return module.default;
  }
  return module;
};

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

export const getDesktopConfigPath = ({
  arguments_ = process.argv.slice(1),
  paths = {},
}: DesktopConfigPathOptions = {}) => {
  const optionIndex = arguments_.findIndex(
    (argument) => argument === "--desktop-config",
  );
  if (optionIndex >= 0) {
    const configuredPath = arguments_[optionIndex + 1];
    if (!configuredPath) {
      throw new Error("--desktop-config requires a file path.");
    }
    return resolve(configuredPath);
  }
  return join(getOvermuxPaths(paths).configDir, "overmux.desktop.ts");
};

export const loadDesktopConfig = async ({
  configApiPath = join(import.meta.dirname, "../config/index.js"),
  configPath,
}: LoadDesktopConfigOptions): Promise<DesktopConfig> => {
  if (!(await fileExists(configPath))) {
    return desktopConfigRuntimeSchema.parse({});
  }
  try {
    const absolutePath = resolve(configPath);
    const jiti = createJiti(absolutePath, {
      alias: { "@overmux/desktop": configApiPath },
      fsCache: true,
      moduleCache: false,
      sourceMaps: true,
      tsconfigPaths: true,
    });
    const module = await jiti.import(absolutePath);
    return desktopConfigRuntimeSchema.parse(unwrapDefaultExport(module));
  } catch (error) {
    throw new Error(`Could not load desktop config at ${configPath}.`, {
      cause: error,
    });
  }
};
