import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const electron = vi.hoisted(() => {
  const exposed = new Map<string, unknown>();
  const listeners = new Map<string, (...arguments_: unknown[]) => void>();
  return {
    contextBridge: {
      exposeInMainWorld: vi.fn((key: string, value: unknown) =>
        exposed.set(key, value),
      ),
    },
    exposed,
    ipcRenderer: {
      on: vi.fn(
        (channel: string, listener: (...arguments_: unknown[]) => void) =>
          listeners.set(channel, listener),
      ),
      removeListener: vi.fn((channel: string) => listeners.delete(channel)),
      send: vi.fn(),
      invoke: vi.fn(async () => undefined),
    },
    listeners,
  };
});

vi.mock("electron", () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer,
}));

type ClipboardBridge = {
  version: 1;
  writeText: (text: string) => void;
};

type NotificationsBridge = {
  show: (input: unknown) => void;
  version: 1;
};

const envelope = {
  id: "00000000-0000-4000-8000-000000000001",
  notification: { title: "Build" },
  type: "notification" as const,
};

type InstanceBridge = {
  version: 1;
  report: (identity: { instanceId: string }) => void;
};

type NativeWebViewBridge = {
  version: 1;
  command: (command: NativeWebViewCommand) => Promise<void>;
  setBounds: (id: string, bounds: NativeWebViewBounds) => void;
  onLoadError: (
    callback: (input: { id: string; error: NativeWebViewError }) => void,
  ) => () => void;
  onPassthroughShortcut: (
    callback: (shortcut: NativeWebViewPassthroughShortcut) => void,
  ) => () => void;
};

let nativeWebView: NativeWebViewBridge;
let instance: InstanceBridge;
let clipboard: ClipboardBridge;
let notifications: NotificationsBridge;

beforeAll(async () => {
  await import("./remote-notifications.js");
  const host = electron.exposed.get("overmuxHost") as {
    clipboard: ClipboardBridge;
    instance: InstanceBridge;
    notifications: NotificationsBridge;
    nativeWebView: NativeWebViewBridge;
  };
  nativeWebView = host.nativeWebView;
  instance = host.instance;
  clipboard = host.clipboard;
  notifications = host.notifications;
});

beforeEach(() => electron.ipcRenderer.send.mockClear());

describe("remote notification preload", () => {
  it("exposes versioned clipboard and notifications bridges", () => {
    expect([...electron.exposed.keys()]).toEqual(["overmuxHost"]);
    expect(clipboard.version).toBe(1);
    expect(Object.keys(clipboard).sort()).toEqual(["version", "writeText"]);
    expect(notifications.version).toBe(1);
    expect(Object.keys(notifications).sort()).toEqual(["show", "version"]);
  });

  it("exposes only versioned OS metadata alongside the capability bridges", () => {
    const host = electron.exposed.get("overmuxHost");
    expect(host).toEqual({
      clipboard,
      instance,
      version: 1,
      platform: process.platform,
      notifications,
      nativeWebView,
    });
  });

  it("exposes only versioned identity reporting on a separate channel", () => {
    expect(instance.version).toBe(1);
    expect(Object.keys(instance).sort()).toEqual(["report", "version"]);

    expect(instance.report({ instanceId: "work" })).toBeUndefined();

    expect(electron.ipcRenderer.send).toHaveBeenCalledExactlyOnceWith(
      remoteInstanceChannels.report,
      { instanceId: "work" },
    );
  });

  it("forwards native view commands and geometry without exposing IPC events", async () => {
    const command = { type: "create" as const, id: crypto.randomUUID() };
    await nativeWebView.command(command);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      nativeWebViewChannels.command,
      command,
    );
    const bounds = { x: 0, y: 0, width: 200, height: 100 };
    nativeWebView.setBounds(command.id, bounds);
    expect(electron.ipcRenderer.send).toHaveBeenCalledWith(
      nativeWebViewChannels.bounds,
      { id: command.id, bounds },
    );
    const callback = vi.fn();
    const unsubscribe = nativeWebView.onLoadError(callback);
    const input = {
      id: command.id,
      error: {
        url: "https://example.com",
        code: "-105",
        message: "DNS failed",
      },
    };
    electron.listeners.get(nativeWebViewChannels.error)!(
      { sender: "privileged" },
      input,
    );
    expect(callback).toHaveBeenCalledExactlyOnceWith(input);
    unsubscribe();
    expect(electron.listeners.has(nativeWebViewChannels.error)).toBe(false);

    const shortcut = vi.fn();
    const unsubscribeShortcut = nativeWebView.onPassthroughShortcut(shortcut);
    const passthrough = { id: command.id, binding: ["F12", "P", "R"] };
    electron.listeners.get(nativeWebViewChannels.shortcut)!(
      { sender: "privileged" },
      passthrough,
    );
    expect(shortcut).toHaveBeenCalledExactlyOnceWith(passthrough);
    unsubscribeShortcut();
    expect(electron.listeners.has(nativeWebViewChannels.shortcut)).toBe(false);
  });

  it("forwards clipboard writes to the main process", () => {
    clipboard.writeText("yanked text");

    expect(electron.ipcRenderer.send).toHaveBeenCalledWith(
      remoteClipboardChannels.writeText,
      "yanked text",
    );
  });

  it("forwards native notification requests for main-process validation", () => {
    const malformed = { ...envelope, extra: true };

    notifications.show(envelope);
    notifications.show(malformed);

    expect(electron.ipcRenderer.send).toHaveBeenCalledTimes(2);
    expect(electron.ipcRenderer.send).toHaveBeenNthCalledWith(
      1,
      remoteNotificationChannels.show,
      envelope,
    );
    expect(electron.ipcRenderer.send).toHaveBeenNthCalledWith(
      2,
      remoteNotificationChannels.show,
      malformed,
    );
  });
});
