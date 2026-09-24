import {
  serverConfigRuntimeSchema,
  type RuntimeConfigDefinition,
} from "@overmux/shared/node";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import type { ServerConfigDefinition } from "../../public/index";

const serverStartupOverridesRuntimeSchema = serverConfigRuntimeSchema
  .omit({ port: true })
  .extend({
    debug: z.boolean().optional(),
    // Port 0 asks the OS for a free port for internal listeners and tests; it must not leak into user config.
    port: z.number().int().min(0).max(65_535).optional(),
  });

export type ResolvedServerStartupOptions = {
  debug: boolean;
  host: string;
  port: number;
  productionWebAssetsDir?: string;
  watch: boolean;
};

export const resolveServerStartupOptions = ({
  config,
  configPath,
  overrides = {},
}: {
  config: RuntimeConfigDefinition;
  configPath: string;
  overrides?: ServerConfigDefinition & { debug?: boolean };
}): ResolvedServerStartupOptions => {
  const validatedOverrides =
    serverStartupOverridesRuntimeSchema.parse(overrides);
  const configuredWebAssetsDir = config.productionWebAssetsDir
    ? resolve(dirname(configPath), config.productionWebAssetsDir)
    : undefined;
  const productionWebAssetsDir = validatedOverrides.productionWebAssetsDir
    ? resolve(validatedOverrides.productionWebAssetsDir)
    : configuredWebAssetsDir;

  return {
    debug: validatedOverrides.debug ?? config.debug ?? true,
    host: validatedOverrides.host ?? config.host ?? "localhost",
    port: validatedOverrides.port ?? config.port ?? 4242,
    ...(productionWebAssetsDir === undefined ? {} : { productionWebAssetsDir }),
    watch: validatedOverrides.watch ?? config.watch ?? true,
  };
};
