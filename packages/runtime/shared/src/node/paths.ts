import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type GetOvermuxPathsOptions = {
  environment?: NodeJS.ProcessEnv;
  homeDir?: string;
  xdgCacheHome?: string;
  xdgConfigHome?: string;
  xdgDataHome?: string;
  xdgRuntimeDir?: string;
  xdgStateHome?: string;
};

export type OvermuxPaths = {
  cacheDir: string;
  configDir: string;
  dataDir: string;
  runtimeDir?: string;
  stateDir: string;
};

const xdgDirectory = (configured: string | undefined, fallback: string) =>
  configured && isAbsolute(configured) ? configured : fallback;

const overmuxDirectory = (root: string) => join(root, "overmux");

export const getOvermuxPaths = ({
  environment = process.env,
  homeDir = homedir(),
  xdgCacheHome = environment.XDG_CACHE_HOME,
  xdgConfigHome = environment.XDG_CONFIG_HOME,
  xdgDataHome = environment.XDG_DATA_HOME,
  xdgRuntimeDir = environment.XDG_RUNTIME_DIR,
  xdgStateHome = environment.XDG_STATE_HOME,
}: GetOvermuxPathsOptions = {}): OvermuxPaths => {
  if (!isAbsolute(homeDir)) {
    throw new TypeError("The home directory must be absolute.");
  }
  const runtimeDir =
    xdgRuntimeDir && isAbsolute(xdgRuntimeDir)
      ? overmuxDirectory(xdgRuntimeDir)
      : undefined;
  return {
    cacheDir: overmuxDirectory(
      xdgDirectory(xdgCacheHome, join(homeDir, ".cache")),
    ),
    configDir: overmuxDirectory(
      xdgDirectory(xdgConfigHome, join(homeDir, ".config")),
    ),
    dataDir: overmuxDirectory(
      xdgDirectory(xdgDataHome, join(homeDir, ".local", "share")),
    ),
    ...(runtimeDir ? { runtimeDir } : {}),
    stateDir: overmuxDirectory(
      xdgDirectory(xdgStateHome, join(homeDir, ".local", "state")),
    ),
  };
};
