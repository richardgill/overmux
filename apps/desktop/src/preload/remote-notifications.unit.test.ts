import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

let instance: InstanceBridge;
let clipboard: ClipboardBridge;
let notifications: NotificationsBridge;

beforeAll(async () => {
  await import("./remote-notifications.js");
  const host = electron.exposed.get("overmuxHost") as {
    clipboard: ClipboardBridge;
    instance: InstanceBridge;
    notifications: NotificationsBridge;
  };
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
