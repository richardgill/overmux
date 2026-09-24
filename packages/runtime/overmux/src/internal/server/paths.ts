import {
  getOvermuxPaths,
  type GetOvermuxPathsOptions,
  type OvermuxPaths,
} from "@overmux/shared/node";
import { join } from "node:path";

export { getOvermuxPaths };
export type { GetOvermuxPathsOptions, OvermuxPaths };

export const getDefaultConfigPath = (
  options: Pick<GetOvermuxPathsOptions, "homeDir" | "xdgConfigHome"> = {},
) => join(getOvermuxPaths(options).configDir, "overmux.config.ts");
