import type { WebContents, WebContentsView } from "electron";

import { getOrigin } from "./url-policy.js";

type NotificationIpcEvent = {
  sender: WebContents;
  senderFrame: WebContents["mainFrame"] | null;
};

export const isActiveRemoteMainFrame = (
  event: NotificationIpcEvent,
  remoteView: WebContentsView | undefined,
  configuredUrl: string | undefined,
) => {
  if (
    !remoteView ||
    !configuredUrl ||
    event.sender !== remoteView.webContents ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    return false;
  }
  try {
    return getOrigin(event.senderFrame.url) === getOrigin(configuredUrl);
  } catch {
    return false;
  }
};
