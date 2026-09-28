import { contextBridge, ipcRenderer } from "electron";

import { nativeWebViewChannels } from "../shared/native-web-view-channels.js";
import type {
  NativeWebViewCommand,
  NativeWebViewBounds,
  NativeWebViewError,
  NativeWebViewPassthroughShortcut,
} from "../shared/native-web-view.js";
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

const nativeWebView = {
  version: 1 as const,
  command: (command: NativeWebViewCommand): Promise<void> =>
    ipcRenderer.invoke(nativeWebViewChannels.command, command),
  setBounds: (id: string, bounds: NativeWebViewBounds) =>
    ipcRenderer.send(nativeWebViewChannels.bounds, { id, bounds }),
  onLoadError: (
    callback: (input: { id: string; error: NativeWebViewError }) => void,
  ) => {
    // Never expose the Electron event (and its privileged sender) across the bridge.
    const listener = (
      _event: Electron.IpcRendererEvent,
      input: { id: string; error: NativeWebViewError },
    ) => callback(input);
    ipcRenderer.on(nativeWebViewChannels.error, listener);
    return () =>
      ipcRenderer.removeListener(nativeWebViewChannels.error, listener);
  },
  onPassthroughShortcut: (
    callback: (shortcut: NativeWebViewPassthroughShortcut) => void,
  ) => {
    // Never expose the Electron event (and its privileged sender) across the bridge.
    const listener = (
      _event: Electron.IpcRendererEvent,
      shortcut: NativeWebViewPassthroughShortcut,
    ) => callback(shortcut);
    ipcRenderer.on(nativeWebViewChannels.shortcut, listener);
    return () =>
      ipcRenderer.removeListener(nativeWebViewChannels.shortcut, listener);
  },
};

// Expose only OS identity, never the process object or its environment variables.
contextBridge.exposeInMainWorld("overmuxHost", {
  version: 1,
  platform: process.platform,
  clipboard,
  instance,
  notifications,
  nativeWebView,
});
