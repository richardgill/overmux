import type { DesktopConfigDefinition } from "./schema";

export type {
  DesktopBeforeInputEventContext,
  DesktopBeforeInputEventHandler,
  DesktopConfigDefinition,
} from "./schema";

export const defineOvermuxDesktopConfig = <
  const TConfig extends DesktopConfigDefinition,
>(
  config: TConfig,
): TConfig => config;
