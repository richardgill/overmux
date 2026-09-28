import { beforeEach, expect, it, vi } from "vitest";

const electron = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  class WebContents extends EventEmitter {
    mainFrame = { url: "https://overmux.test/" };
    destroyed = false;
    close = vi.fn(() => {
      this.destroyed = true;
      this.emit("destroyed");
    });
    isDestroyed = () => this.destroyed;
    loadURL = vi.fn((_url: string): Promise<void> => new Promise(() => {}));
    getURL = vi.fn(() => "https://github.com/");
    getZoomFactor = () => 1;
    send = vi.fn();
    setWindowOpenHandler = vi.fn();
  }
  class WebContentsView {
    static instances: WebContentsView[] = [];
    webContents = new WebContents();
    setVisible = vi.fn();
    setBounds = vi.fn();
    getBounds = () => ({ x: 0, y: 20, width: 800, height: 600 });
    constructor(public options?: unknown) {
      WebContentsView.instances.push(this);
    }
  }
  const dedicatedSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
  });
  const ipcMain = Object.assign(new EventEmitter(), {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  });
  return {
    WebContentsView,
    ipcMain,
    dedicatedSession,
    session: { fromPartition: vi.fn(() => dedicatedSession) },
    shell: { openExternal: vi.fn(async () => {}) },
  };
});
vi.mock("electron", () => electron);

import { nativeWebViewChannels } from "../shared/native-web-view-channels.js";
import { NativeWebViews } from "./native-web-views.js";

const setup = () => {
  const owner = new electron.WebContentsView();
  const window = {
    isDestroyed: () => false,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  };
  let active = owner;
  const manager = new NativeWebViews({
    getConfiguredUrl: () => "https://overmux.test",
    getRemoteView: () => active as never,
    getWindow: () => window as never,
  });
  const dispose = manager.registerIpc(electron.ipcMain as never);
  const handler = electron.ipcMain.handle.mock.calls.at(-1)![1] as (
    event: unknown,
    input: unknown,
  ) => void;
  const event = {
    sender: owner.webContents,
    senderFrame: owner.webContents.mainFrame,
  };
  const id = crypto.randomUUID();
  const command = (input: object, sender = event) =>
    handler(sender, { id, ...input });
  const create = () => {
    command({ type: "create" });
    return electron.WebContentsView.instances.at(-1)!;
  };
  return {
    owner,
    window,
    manager,
    command,
    event,
    id,
    create,
    dispose,
    replace: () => {
      active = new electron.WebContentsView();
      return {
        sender: active.webContents,
        senderFrame: active.webContents.mainFrame,
      };
    },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  electron.ipcMain.removeAllListeners();
  electron.WebContentsView.instances.length = 0;
});

it("uses one dedicated persistent sandboxed session, denies permissions and downloads", () => {
  const test = setup();
  const first = test.create();
  test.command({ type: "create", id: crypto.randomUUID() });
  expect(electron.session.fromPartition).toHaveBeenCalledWith(
    "persist:overmux-native-web",
  );
  expect(first.options).toEqual({
    webPreferences: {
      session: electron.dedicatedSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  const callback = vi.fn();
  electron.dedicatedSession.setPermissionRequestHandler.mock.calls[0]![0](
    null,
    "camera",
    callback,
  );
  expect(callback).toHaveBeenCalledWith(false);
  expect(
    electron.dedicatedSession.setPermissionCheckHandler.mock.calls[0]![0](),
  ).toBe(false);
  expect(
    electron.dedicatedSession.setDevicePermissionHandler.mock.calls[0]![0](),
  ).toBe(false);
  const event = { preventDefault: vi.fn() };
  electron.dedicatedSession.emit("will-download", event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  test.dispose();
});

it("rejects subframes, other renderers, stale owners and duplicate IDs", () => {
  const test = setup();
  const view = test.create();
  expect(() => test.command({ type: "create" })).toThrow("already exists");
  expect(() =>
    test.command(
      { type: "destroy" },
      { ...test.event, senderFrame: { url: "https://overmux.test/" } },
    ),
  ).toThrow("untrusted");
  const replacement = test.replace();
  expect(() => test.command({ type: "destroy" })).toThrow("untrusted");
  expect(() => test.command({ type: "destroy" }, replacement)).toThrow(
    "another document",
  );
  expect(view.webContents.close).not.toHaveBeenCalled();
  test.dispose();
  expect(view.webContents.close).toHaveBeenCalledOnce();
});

it("does not reload unchanged URLs, but enforces policy on changes, redirects and popups", async () => {
  const test = setup();
  const view = test.create();
  const configuration = {
    type: "configure",
    url: "https://github.com/",
    allowedHttpOrigins: [],
  };
  expect(() =>
    test.command({ ...configuration, allowedHttpOrigins: ["http://*.test"] }),
  ).toThrow("Invalid HTTP origin");
  test.command(configuration);
  view.webContents.getURL.mockReturnValue("https://github.com/other-page");
  test.command(configuration);
  expect(view.webContents.loadURL).toHaveBeenCalledTimes(1);
  test.command({ ...configuration, url: "http://unsafe.test/" });
  expect(view.webContents.loadURL).toHaveBeenLastCalledWith("about:blank");
  expect(test.owner.webContents.send).toHaveBeenLastCalledWith(
    nativeWebViewChannels.error,
    {
      id: test.id,
      error: expect.objectContaining({ code: "ERR_URL_BLOCKED" }),
    },
  );
  const redirect = {
    url: "http://unsafe.test/",
    isMainFrame: true,
    preventDefault: vi.fn(),
  };
  view.webContents.emit("will-redirect", redirect);
  expect(redirect.preventDefault).toHaveBeenCalledOnce();
  const navigate = {
    ...redirect,
    url: "file:///etc/passwd",
    preventDefault: vi.fn(),
  };
  view.webContents.emit("will-frame-navigate", navigate);
  expect(navigate.preventDefault).toHaveBeenCalledOnce();
  const popup = view.webContents.setWindowOpenHandler.mock.calls[0]![0];
  expect(popup({ url: "https://github.com/login" })).toEqual({
    action: "deny",
  });
  expect(popup({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
  await Promise.resolve();
  expect(electron.shell.openExternal).toHaveBeenCalledExactlyOnceWith(
    "https://github.com/login",
  );
  test.command({ ...configuration, url: "https://github.com/login" });
  expect(view.webContents.loadURL).toHaveBeenLastCalledWith(
    "https://github.com/login",
  );
  test.dispose();
});

it("revokes an HTTP allowance even when the requested URL is unchanged", () => {
  const test = setup();
  const view = test.create();
  const url = "http://devbox.local:3000/";
  test.command({
    type: "configure",
    url,
    allowedHttpOrigins: ["http://devbox.local:3000"],
  });
  view.webContents.getURL.mockReturnValue(url);

  test.command({ type: "configure", url, allowedHttpOrigins: [] });

  expect(view.webContents.loadURL).toHaveBeenLastCalledWith("about:blank");
  const navigation = { url, isMainFrame: true, preventDefault: vi.fn() };
  view.webContents.emit("will-frame-navigate", navigation);
  expect(navigation.preventDefault).toHaveBeenCalledOnce();
  test.dispose();
});

it("reports main-frame failures only and destroys loading views without waiting for navigation", () => {
  const test = setup();
  const view = test.create();
  test.command({
    type: "configure",
    url: "https://github.com/",
    allowedHttpOrigins: [],
  });
  view.webContents.emit(
    "did-fail-load",
    {},
    -3,
    "aborted",
    "https://github.com",
    true,
  );
  view.webContents.emit(
    "did-fail-load",
    {},
    -105,
    "subresource",
    "https://github.com",
    false,
  );
  expect(test.owner.webContents.send).not.toHaveBeenCalled();
  view.webContents.emit(
    "did-fail-load",
    {},
    -105,
    "DNS failed",
    "https://github.com",
    true,
  );
  expect(test.owner.webContents.send).toHaveBeenCalledExactlyOnceWith(
    nativeWebViewChannels.error,
    {
      id: test.id,
      error: { url: "https://github.com", code: "-105", message: "DNS failed" },
    },
  );
  test.manager.clear();
  view.webContents.emit(
    "did-fail-load",
    {},
    -105,
    "late failure",
    "https://github.com",
    true,
  );
  expect(test.owner.webContents.send).toHaveBeenCalledTimes(1);
  test.command({ type: "destroy" });
  expect(view.webContents.close).toHaveBeenCalledExactlyOnceWith({
    waitForBeforeUnload: false,
  });
  expect(
    test.window.contentView.removeChildView,
  ).toHaveBeenCalledExactlyOnceWith(view);
  expect(() =>
    test.command({
      type: "configure",
      url: "https://github.com",
      allowedHttpOrigins: [],
    }),
  ).toThrow("no longer exists");
  test.dispose();
});

it("handles Electron clearing the view's contents during external destruction", () => {
  const test = setup();
  const view = test.create();
  const contents = view.webContents;
  Object.defineProperty(view, "webContents", { value: undefined });

  expect(() => contents.close()).not.toThrow();
  test.manager.clear();

  expect(contents.close).toHaveBeenCalledOnce();
  expect(
    test.window.contentView.removeChildView,
  ).toHaveBeenCalledExactlyOnceWith(view);
  test.dispose();
});

it("positions inside the host and hides zero-size surfaces", () => {
  const test = setup();
  const view = test.create();
  expect(view.setVisible).toHaveBeenCalledWith(false);
  electron.ipcMain.emit(nativeWebViewChannels.bounds, test.event, {
    id: test.id,
    bounds: { x: 10, y: 10, width: 300, height: 200 },
  });
  expect(view.setBounds).toHaveBeenLastCalledWith({
    x: 10,
    y: 30,
    width: 300,
    height: 200,
  });
  expect(view.setVisible).toHaveBeenLastCalledWith(true);
  electron.ipcMain.emit(nativeWebViewChannels.bounds, test.event, {
    id: test.id,
    bounds: { x: 10, y: 10, width: 0, height: 0 },
  });
  expect(view.setVisible).toHaveBeenLastCalledWith(false);
  test.dispose();
});
