import { contextBridge, ipcRenderer } from "electron";

import { remoteClipboardChannels } from "../shared/remote-clipboard.js";
import { remoteInstanceChannels } from "../shared/remote-instance.js";
import { remoteNotificationChannels } from "../shared/remote-notifications.js";

const clipboard = {
  version: 1 as const,
  writeText: (text: string) => {
    ipcRenderer.send(remoteClipboardChannels.writeText, text);
  },
};

const notifications = {
  version: 1 as const,
  show: (input: unknown) => {
    ipcRenderer.send(remoteNotificationChannels.show, input);
  },
};

const instance = {
  version: 1 as const,
  report: (identity: { instanceId: string }) => {
    ipcRenderer.send(remoteInstanceChannels.report, identity);
  },
};

// Expose only OS identity, never the process object or its environment variables.
contextBridge.exposeInMainWorld("overmuxHost", {
  version: 1,
  platform: process.platform,
  clipboard,
  instance,
  notifications,
});
