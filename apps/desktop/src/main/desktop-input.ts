import type {
  DesktopBeforeInputEventContext,
  DesktopBeforeInputEventHandler,
} from "../config/schema.js";

export const runDesktopBeforeInputEvent = (
  handler: DesktopBeforeInputEventHandler | undefined,
  context: DesktopBeforeInputEventContext,
) => {
  try {
    handler?.(context);
  } catch (error) {
    // Local config failures must not crash input dispatch; retain any cancellation.
    console.error("Desktop onBeforeInputEvent failed:", error);
  }
};
