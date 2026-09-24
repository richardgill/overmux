import { notificationSchema } from "@overmux/shared";
import {
  Notification,
  type BrowserWindow,
  type IpcMain,
  type WebContentsView,
} from "electron";
import { z } from "zod";

import { remoteNotificationChannels } from "../shared/remote-notifications.js";
import { isActiveRemoteMainFrame } from "./remote-notification-policy.js";
import {
  decideNavigation,
  getOrigin,
  resolveNotificationLink,
} from "./url-policy.js";

const notificationEventSchema = z
  .object({ notification: notificationSchema, type: z.literal("notification") })
  .strict();

type RemoteNotificationOptions = {
  getConfiguredUrl: () => string | undefined;
  getRemoteView: () => WebContentsView | undefined;
  getWindow: () => BrowserWindow | undefined;
  ipcMain: IpcMain;
  openExternal: (url: string) => Promise<void>;
};

export const installRemoteNotifications = ({
  getConfiguredUrl,
  getRemoteView,
  getWindow,
  ipcMain,
  openExternal,
}: RemoteNotificationOptions) => {
  const activeNotifications = new Set<Notification>();
  const show = (event: Electron.IpcMainEvent, input: unknown) => {
    if (
      !Notification.isSupported() ||
      !isActiveRemoteMainFrame(event, getRemoteView(), getConfiguredUrl())
    ) {
      return;
    }
    const parsed = notificationEventSchema.safeParse(input);
    if (!parsed.success) {
      return;
    }
    const notification = new Notification({
      body: parsed.data.notification.body,
      title: parsed.data.notification.title,
    });
    activeNotifications.add(notification);
    const release = () => {
      const timer = setTimeout(
        () => activeNotifications.delete(notification),
        60_000,
      );
      timer.unref();
    };
    notification.on("close", release);
    notification.on("failed", release);
    notification.on("click", () => {
      if (
        !isActiveRemoteMainFrame(
          { sender: event.sender, senderFrame: event.sender.mainFrame },
          getRemoteView(),
          getConfiguredUrl(),
        )
      ) {
        return;
      }
      const window = getWindow();
      if (window && !window.isDestroyed()) {
        window.show();
        window.focus();
      }
      const link = parsed.data.notification.open?.link;
      const configuredUrl = getConfiguredUrl();
      if (link && configuredUrl) {
        try {
          const destination = resolveNotificationLink(link, configuredUrl);
          const decision = decideNavigation(
            destination,
            getOrigin(configuredUrl),
          );
          if (decision.type === "allow") {
            void event.sender.loadURL(destination);
          }
          if (decision.type === "external") {
            // Defer until libnotify's action callback returns to avoid crashing Electron on Linux.
            setImmediate(() => void openExternal(destination));
          }
        } catch {
          return;
        }
      }
      event.sender.focus();
    });
    notification.show();
  };
  ipcMain.on(remoteNotificationChannels.show, show);
  return () => ipcMain.removeListener(remoteNotificationChannels.show, show);
};
