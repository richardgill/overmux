import { clipboard, type IpcMain, type WebContentsView } from "electron";

import { remoteClipboardChannels } from "../shared/remote-clipboard.js";
import { isActiveRemoteMainFrame } from "./remote-notification-policy.js";

type RemoteClipboardOptions = {
  getConfiguredUrl: () => string | undefined;
  getRemoteView: () => WebContentsView | undefined;
  ipcMain: IpcMain;
};

export const installRemoteClipboard = ({
  getConfiguredUrl,
  getRemoteView,
  ipcMain,
}: RemoteClipboardOptions) => {
  const writeText = (event: Electron.IpcMainEvent, input: unknown) => {
    if (
      typeof input !== "string" ||
      !isActiveRemoteMainFrame(event, getRemoteView(), getConfiguredUrl())
    ) {
      return;
    }
    clipboard.writeText(input);
  };
  ipcMain.on(remoteClipboardChannels.writeText, writeText);
  return () =>
    ipcMain.removeListener(remoteClipboardChannels.writeText, writeText);
};
