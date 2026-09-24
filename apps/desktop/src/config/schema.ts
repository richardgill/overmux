import { z } from "zod";

export const desktopConfigRuntimeSchema = z
  .object({
    macosTitleBarStyle: z.enum(["native", "transparent"]).optional(),
    macosTrafficLights: z.enum(["hidden", "visible"]).default("hidden"),
    menuBar: z.enum(["auto-hide", "hidden", "visible"]).default("auto-hide"),
    titleBar: z.enum(["hidden", "native"]).default("hidden"),
  })
  .strict();

export type DesktopConfigDefinition = z.input<
  typeof desktopConfigRuntimeSchema
>;
export type DesktopConfig = z.output<typeof desktopConfigRuntimeSchema>;
