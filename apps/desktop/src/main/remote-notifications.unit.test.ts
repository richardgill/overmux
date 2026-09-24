import { afterEach, describe, expect, it, vi } from "vitest";

import { remoteNotificationChannels } from "../shared/remote-notifications.js";
import { installRemoteNotifications } from "./remote-notifications.js";

const electron = vi.hoisted(() => {
  const instances: Array<{
    listeners: Map<string, () => void>;
    options: unknown;
    show: ReturnType<typeof vi.fn>;
  }> = [];
  class Notification {
    static isSupported = vi.fn(() => true);
    listeners = new Map<string, () => void>();
    show = vi.fn();
    constructor(readonly options: unknown) {
      instances.push(this);
    }
    on(event: string, listener: () => void) {
      this.listeners.set(event, listener);
      return this;
    }
  }
  return { instances, Notification };
});

vi.mock("electron", () => ({ Notification: electron.Notification }));

const createHarness = () => {
  const source = {
    focus: vi.fn(),
    loadURL: vi.fn(),
    mainFrame: { url: "https://overmux.test/workspace" },
  };
  const window = {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    show: vi.fn(),
  };
  const listeners = new Map<string, (...args: never[]) => void>();
  const ipcMain = {
    on: vi.fn((channel, listener) => listeners.set(channel, listener)),
    removeListener: vi.fn((channel) => listeners.delete(channel)),
  };
  const openExternal = vi.fn(async () => undefined);
  const dispose = installRemoteNotifications({
    getConfiguredUrl: () => "https://overmux.test",
    getRemoteView: () => ({ webContents: source }) as never,
    getWindow: () => window as never,
    ipcMain: ipcMain as never,
    openExternal,
  });
  return {
    dispose,
    ipcMain,
    openExternal,
    show: (input: unknown) =>
      listeners.get(remoteNotificationChannels.show)?.(
        { sender: source, senderFrame: source.mainFrame } as never,
        input as never,
      ),
    source,
    window,
  };
};

const event = {
  notification: {
    body: "Complete",
    open: { link: "/tasks/1" },
    title: "Build",
  },
  type: "notification" as const,
};

describe("remote notifications", () => {
  afterEach(() => {
    electron.instances.length = 0;
  });
  it("shows validated notifications and navigates same-origin paths on click", () => {
    const harness = createHarness();
    harness.show(event);
    expect(electron.instances[0]?.options).toEqual({
      body: "Complete",
      title: "Build",
    });
    electron.instances[0]?.listeners.get("click")?.();
    expect(harness.source.loadURL).toHaveBeenCalledWith(
      "https://overmux.test/tasks/1",
    );
    expect(harness.window.focus).toHaveBeenCalledOnce();
  });
  it("opens absolute notification links externally", async () => {
    const harness = createHarness();
    harness.show({
      ...event,
      notification: {
        ...event.notification,
        open: { link: "https://github.com/example/repository" },
      },
    });
    electron.instances[0]?.listeners.get("click")?.();
    await vi.waitFor(() =>
      expect(harness.openExternal).toHaveBeenCalledWith(
        "https://github.com/example/repository",
      ),
    );
    expect(harness.source.loadURL).not.toHaveBeenCalled();
  });
  it("does not navigate hostile notification paths", () => {
    const harness = createHarness();
    harness.show({
      ...event,
      notification: { ...event.notification, open: { link: "/%5Cevil.test" } },
    });
    electron.instances[0]?.listeners.get("click")?.();
    expect(harness.source.loadURL).not.toHaveBeenCalled();
  });

  it("rejects invalid and untrusted inputs", () => {
    const harness = createHarness();
    harness.show({ type: "notification" });
    expect(electron.instances).toHaveLength(0);
  });
  it("removes its IPC listener", () => {
    const harness = createHarness();
    harness.dispose();
    expect(harness.ipcMain.removeListener).toHaveBeenCalledWith(
      remoteNotificationChannels.show,
      expect.any(Function),
    );
  });
});
