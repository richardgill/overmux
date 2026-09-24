import { contextBridge, ipcRenderer } from "electron";

import {
  ipcChannels,
  type DesktopApi,
  type HostState,
} from "../shared/contracts.js";

const desktopApi: DesktopApi = {
  connect: (request) => ipcRenderer.invoke(ipcChannels.connect, request),
  getState: () => ipcRenderer.invoke(ipcChannels.getState),
  onState: (listener) => {
    const handleState = (_event: Electron.IpcRendererEvent, state: HostState) =>
      listener(state);
    ipcRenderer.on(ipcChannels.state, handleState);
    return () => ipcRenderer.removeListener(ipcChannels.state, handleState);
  },
};

contextBridge.exposeInMainWorld("overmuxDesktop", desktopApi);
