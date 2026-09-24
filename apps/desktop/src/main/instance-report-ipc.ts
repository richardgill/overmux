import { instanceIdSchema } from "@overmux/shared";
import type { IpcMain, WebContentsView } from "electron";
import { z } from "zod";

import { remoteInstanceChannels } from "../shared/remote-instance.js";
import { isActiveRemoteMainFrame } from "./remote-notification-policy.js";

// Validates instance ID reports from the current server-hosted page before passing them to ServerPage.
const identityReportSchema = z
  .object({ instanceId: instanceIdSchema })
  .strict();

type InstanceReportIpcOptions = {
  getConfiguredUrl: () => string | undefined;
  getRemoteView: () => WebContentsView | undefined;
  ipcMain: IpcMain;
  onReport: (instanceId: string) => void;
};

export const installInstanceReportIpc = ({
  getConfiguredUrl,
  getRemoteView,
  ipcMain,
  onReport,
}: InstanceReportIpcOptions) => {
  const report = (event: Electron.IpcMainEvent, input: unknown) => {
    // Frame properties may throw after renderer destruction. Never accept a
    // queued message from a detached document, even at the configured origin.
    try {
      if (
        event.sender.isDestroyed() ||
        !event.senderFrame ||
        event.senderFrame.detached ||
        !isActiveRemoteMainFrame(event, getRemoteView(), getConfiguredUrl())
      ) {
        return;
      }
    } catch {
      return;
    }
    const parsed = identityReportSchema.safeParse(input);
    if (parsed.success) {
      onReport(parsed.data.instanceId);
    }
  };
  ipcMain.on(remoteInstanceChannels.report, report);
  return () => ipcMain.removeListener(remoteInstanceChannels.report, report);
};
