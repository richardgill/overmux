import type { Event, Input, WebContents } from "electron";
import { z } from "zod";

export type DesktopBeforeInputEventContext = {
  event: Event;
  input: Input;
  webContents: WebContents;
};

// Runs synchronously before native-view passthrough; call event.preventDefault() to cancel.
export type DesktopBeforeInputEventHandler = (
  context: DesktopBeforeInputEventContext,
) => void;

export const desktopConfigRuntimeSchema = z
  .object({
    macosTitleBarStyle: z.enum(["native", "transparent"]).optional(),
    macosTrafficLights: z.enum(["hidden", "visible"]).default("hidden"),
    menuBar: z.enum(["auto-hide", "hidden", "visible"]).default("auto-hide"),
    titleBar: z.enum(["hidden", "native"]).default("hidden"),
    onBeforeInputEvent: z
      .custom<DesktopBeforeInputEventHandler>(
        (value) => typeof value === "function",
        "onBeforeInputEvent must be a function",
      )
      .optional(),
  })
  .strict();

export type DesktopConfigDefinition = z.input<
  typeof desktopConfigRuntimeSchema
>;
export type DesktopConfig = z.output<typeof desktopConfigRuntimeSchema>;
