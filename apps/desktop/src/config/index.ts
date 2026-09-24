import type { DesktopConfigDefinition } from "./schema";

export type { DesktopConfigDefinition } from "./schema";

export const defineOvermuxDesktopConfig = <
  const TConfig extends DesktopConfigDefinition,
>(
  config: TConfig,
): TConfig => config;
