import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  afterEach,
  beforeEach,
  expect,
  it,
  test as testCases,
  vi,
} from "vitest";

const electron = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const onLoad = vi.fn(
    async (_contents: WebContents): Promise<void> => undefined,
  );
  class WebContents extends EventEmitter {
    executeJavaScript = vi.fn(
      async (_code: string): Promise<void> => undefined,
    );
    mainFrame = {
      url: "about:blank",
      detached: false,
      executeJavaScript: this.executeJavaScript,
    };
    destroyed = false;
    loadURL = vi.fn(async (url: string) => {
      this.emit("did-start-navigation", {}, url, false, true);
      this.mainFrame = {
        url,
        detached: false,
        executeJavaScript: this.executeJavaScript,
      };
      this.emit("did-frame-navigate", {}, url, 200, "OK", true);
      await onLoad(this);
    });
    close = () => {
      this.destroyed = true;
      this.emit("destroyed");
    };
    isDestroyed = () => this.destroyed;
    focus = vi.fn();
    send = vi.fn();
    setWindowOpenHandler = vi.fn();
  }
  class BrowserWindow extends EventEmitter {
    static instances: BrowserWindow[] = [];
    constructor() {
      super();
      BrowserWindow.instances.push(this);
    }
    show = vi.fn();
    focus = vi.fn();
    webContents = new WebContents();
    contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
    loadFile = async () => undefined;
    isFocused = () => true;
    isDestroyed = () => false;
    getContentBounds = () => ({ width: 1200, height: 800 });
    setMenuBarVisibility = vi.fn();
    setWindowButtonVisibility = vi.fn();
  }
  class WebContentsView {
    static instances: WebContentsView[] = [];
    webContents = new WebContents();
    setBounds = vi.fn();
    constructor() {
      WebContentsView.instances.push(this);
    }
  }
  return {
    BrowserWindow,
    WebContentsView,
    onLoad,
    ipcMain: Object.assign(new EventEmitter(), { handle: vi.fn() }),
    dialog: {
      showMessageBox: vi.fn(
        async (_window: unknown, _options?: { signal?: AbortSignal }) => ({
          response: 1,
        }),
      ),
    },
    session: Object.assign(new EventEmitter(), {
      clearStorageData: vi.fn(async () => undefined),
      clearCache: vi.fn(async () => undefined),
    }),
  };
});
vi.mock("electron", () => electron);

import { desktopConfigRuntimeSchema } from "../config/schema.js";
import { remoteInstanceChannels } from "../shared/remote-instance.js";
import { ConfigStore } from "./config-store.js";
import { DesktopApp } from "./desktop-app.js";

type Contents = InstanceType<typeof electron.WebContentsView>["webContents"];
const url = "https://overmux.test/workspace";
let directory: string;
let store: ConfigStore;
let host: DesktopApp;

const createHost = (serverUrl?: string) =>
  new DesktopApp({
    serverUrl,
    config: desktopConfigRuntimeSchema.parse({}),
    configStore: store,
    remoteSession: electron.session as never,
  });
const currentContents = () =>
  electron.WebContentsView.instances.at(-1)!.webContents;
const report = (
  contents: Contents,
  input: unknown,
  frame = contents.mainFrame,
) =>
  electron.ipcMain.emit(
    remoteInstanceChannels.report,
    { sender: contents, senderFrame: frame },
    input,
  );
const connect = (address = url) =>
  host.connect({ url: address, allowInsecure: false });
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(async () => {
  vi.clearAllMocks();
  electron.ipcMain.removeAllListeners();
  electron.WebContentsView.instances.length = 0;
  electron.BrowserWindow.instances.length = 0;
  electron.onLoad.mockReset().mockResolvedValue(undefined);
  const root = resolve(import.meta.dirname, "../../../../.test-tmp");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(resolve(root, "discovery-"));
  store = new ConfigStore(resolve(directory, "desktop-config.json"));
  host = createHost();
  host.registerIpc();
  await host.open();
});

afterEach(async () => {
  host.cancelDeepLink();
  vi.useRealTimers();
  await store.load();
  await rm(directory, { force: true, recursive: true });
  vi.restoreAllMocks();
});

testCases.each(["connect", "configured", "restore"] as const)(
  "learns authenticated identity before %s finishes loading",
  async (mode) => {
    if (mode !== "connect") {
      if (mode === "restore") {
        await store.save({ url, instanceAddresses: [] });
      }
      host = createHost(mode === "configured" ? url : undefined);
      electron.ipcMain.removeAllListeners();
      host.registerIpc();
    }
    const loading = deferred();
    electron.onLoad.mockImplementationOnce(async (contents) => {
      report(contents, { instanceId: "work.station-1" });
      await loading.promise;
    });

    const pending = mode === "connect" ? connect() : host.open();

    await vi.waitFor(() => expect(electron.onLoad).toHaveBeenCalled());
    if (mode === "configured") {
      expect(host.getState().instanceId).toBeUndefined();
    } else {
      expect(host.getState().instanceId).toBe("work.station-1");
      expect(await store.load()).toEqual({
        url,
        instanceAddresses: [{ url, instanceId: "work.station-1" }],
      });
    }
    loading.resolve();
    await pending;
    await vi.waitFor(() =>
      expect(host.getState()).toMatchObject({
        configuredUrl: url,
        instanceId: "work.station-1",
      }),
    );
    expect(await store.load()).toEqual({
      url,
      instanceAddresses: [{ url, instanceId: "work.station-1" }],
    });
  },
);

testCases.each([
  { name: "extra field", input: { instanceId: "work", url } },
  { name: "missing ID", input: {} },
  { name: "uppercase ID", input: { instanceId: "Work" } },
  { name: "invalid ID", input: { instanceId: "-work" } },
  { name: "oversized ID", input: { instanceId: "a".repeat(254) } },
  { name: "non-object", input: "work" },
])("rejects $name at the IPC boundary", async ({ input }) => {
  await connect();
  report(currentContents(), input);
  expect(host.getState().instanceId).toBeUndefined();
  expect((await store.load())?.instanceAddresses).toEqual([]);
});

it("rejects old views, old frames, detached frames, other origins and destroyed renderers", async () => {
  await connect();
  const old = currentContents();
  await connect("https://other.test/");
  const current = currentContents();
  const frame = current.mainFrame;

  report(old, { instanceId: "old-view" });
  report(current, { instanceId: "old-frame" }, { ...frame });
  current.mainFrame = { ...frame, url: "https://evil.test/" };
  report(current, { instanceId: "wrong-origin" });
  current.mainFrame = { ...frame, detached: true };
  report(current, { instanceId: "detached" });
  current.mainFrame = frame;
  current.close();
  report(current, { instanceId: "destroyed" });

  expect(host.getState().instanceId).toBeUndefined();
  expect((await store.load())?.instanceAddresses).toEqual([]);
});

it("resets identity on document navigation and keeps the selected address, not the page route", async () => {
  await connect();
  const contents = currentContents();
  report(contents, { instanceId: "before" });
  contents.emit("did-start-navigation", {}, `${url}/next`, false, true);
  report(contents, { instanceId: "old-document" });
  expect(host.getState().instanceId).toBeUndefined();

  await contents.loadURL(`${url}/next`);
  report(contents, { instanceId: "after" });

  expect(await store.load()).toEqual({
    url,
    instanceAddresses: [{ url, instanceId: "after" }],
  });
  contents.emit("render-process-gone", {});
  expect(host.getState().instanceId).toBeUndefined();
});

it("remembers aliases, replaces a URL's old ID, and orders known addresses by recent use", async () => {
  const alias = "https://alias.test/";
  await connect();
  report(currentContents(), { instanceId: "old" });
  report(currentContents(), { instanceId: "work" });
  await connect(alias);
  report(currentContents(), { instanceId: "work" });
  expect((await store.load())?.instanceAddresses).toEqual([
    { url: alias, instanceId: "work" },
    { url, instanceId: "work" },
  ]);

  await connect();
  expect(host.getState().instanceId).toBeUndefined();
  expect((await store.load())?.instanceAddresses).toEqual([
    { url, instanceId: "work" },
    { url: alias, instanceId: "work" },
  ]);
  report(currentContents(), { instanceId: "replacement" });
  expect((await store.load())?.instanceAddresses).toEqual([
    { url, instanceId: "replacement" },
    { url: alias, instanceId: "work" },
  ]);
});

testCases.each(["resolve", "reject"] as const)(
  "ignores a superseded connection's late %s and report",
  async (completion) => {
    const loading = deferred();
    electron.onLoad.mockReturnValueOnce(loading.promise);
    const first = connect();
    const old = currentContents();
    await connect("https://new.test/");
    report(currentContents(), { instanceId: "new" });
    report(old, { instanceId: "stale" });

    if (completion === "resolve") {
      loading.resolve();
    } else {
      loading.reject(new Error("old load failed"));
    }
    expect((await first).status).toBe("error");
    expect(host.getState()).toEqual({
      configuredUrl: "https://new.test/",
      instanceId: "new",
      error: undefined,
    });
    expect(await store.load()).toEqual({
      url: "https://new.test/",
      instanceAddresses: [{ url: "https://new.test/", instanceId: "new" }],
    });
  },
);

it("clear invalidates a loading view and its reports without forgetting other addresses", async () => {
  await connect("https://other.test/");
  report(currentContents(), { instanceId: "other" });
  const loading = deferred();
  electron.onLoad.mockReturnValueOnce(loading.promise);
  const pending = connect();
  const old = currentContents();
  report(old, { instanceId: "work" });

  await host.clearWithConfirmation();
  report(old, { instanceId: "stale" });
  loading.resolve();
  expect((await pending).status).toBe("error");
  expect(host.getState().configuredUrl).toBeUndefined();
  expect(host.getState().instanceId).toBeUndefined();
  expect(await store.load()).toEqual({
    instanceAddresses: [{ url: "https://other.test/", instanceId: "other" }],
  });
});

it("loads remembered instance addresses even when a configured launch skips restoring the URL", async () => {
  await store.save({ url, instanceAddresses: [{ url, instanceId: "work" }] });
  host = createHost("https://alias.test/");
  electron.ipcMain.removeAllListeners();
  host.registerIpc();
  await host.open();
  expect(electron.WebContentsView.instances).toHaveLength(1);
  expect(currentContents().loadURL).toHaveBeenCalledWith("https://alias.test/");
  await vi.waitFor(() =>
    expect(host.getState().configuredUrl).toBe("https://alias.test/"),
  );
  report(currentContents(), { instanceId: "work" });
  expect((await store.load())?.instanceAddresses).toEqual([
    { url: "https://alias.test/", instanceId: "work" },
    { url, instanceId: "work" },
  ]);
});

testCases.each([
  "success",
  "failure",
  "replacement",
  "replacement-failure",
  "link",
  "link-failure",
] as const)(
  "handles cached identity on configured reset: %s",
  async (outcome) => {
    host = createHost(url);
    electron.ipcMain.removeAllListeners();
    host.registerIpc();
    await host.open();
    await connect("https://other.test/");
    report(currentContents(), { instanceId: "other" });
    const active = currentContents();
    const loading = deferred();
    electron.onLoad.mockImplementationOnce(async (contents) => {
      report(contents, { instanceId: "configured" });
      await loading.promise;
    });

    const pending = host.reset();
    await vi.waitFor(() => expect(currentContents()).not.toBe(active));
    const candidate = currentContents();
    electron.onLoad.mockImplementationOnce(async (contents) => {
      report(contents, { instanceId: "other" });
    });
    const routing = outcome.startsWith("link")
      ? host.routeDeepLink("overmux://other/route")
      : undefined;
    await routing;
    expect(host.getState().instanceId).toBe("other");
    expect(active.isDestroyed()).toBe(false);
    if (outcome.startsWith("replacement")) {
      await connect("https://new.test/");
      report(currentContents(), { instanceId: "new" });
    }
    if (outcome.endsWith("failure")) {
      loading.reject(new Error("offline"));
    } else {
      loading.resolve();
    }
    await pending;

    const instanceId =
      outcome === "success"
        ? "configured"
        : outcome === "failure" || routing
          ? "other"
          : "new";
    expect(host.getState().instanceId).toBe(instanceId);
    if (outcome !== "failure") {
      expect(host.getState().error).toBeUndefined();
    }
    expect(candidate.isDestroyed()).toBe(outcome !== "success");
    expect(
      (await store.load())?.instanceAddresses.map((entry) => entry.instanceId),
    ).toEqual(
      outcome === "success"
        ? ["configured", "other"]
        : outcome === "failure" || routing
          ? ["other"]
          : ["new", "other"],
    );
  },
);

testCases.each(["replace", "close"] as const)(
  "releases a detached reset and its listener on %s without waiting for the server",
  async (action) => {
    host = createHost(url);
    electron.ipcMain.removeAllListeners();
    host.registerIpc();
    await host.open();
    await connect("https://other.test/");
    const listeners = electron.ipcMain.listenerCount(
      remoteInstanceChannels.report,
    );
    const active = currentContents();
    const loading = deferred();
    electron.onLoad.mockReturnValueOnce(loading.promise);
    const resetting = host.reset();
    await vi.waitFor(() => expect(currentContents()).not.toBe(active));
    const candidate = currentContents();
    expect(electron.ipcMain.listenerCount(remoteInstanceChannels.report)).toBe(
      listeners + 1,
    );

    if (action === "replace") {
      await connect("https://replacement.test/");
    } else {
      electron.BrowserWindow.instances.at(-1)!.emit("closed");
    }
    await resetting;

    expect(candidate.isDestroyed()).toBe(true);
    expect(electron.ipcMain.listenerCount(remoteInstanceChannels.report)).toBe(
      listeners,
    );
    expect(host.getState().configuredUrl).toBe(
      action === "replace"
        ? "https://replacement.test/"
        : "https://other.test/",
    );
    loading.resolve();
    if (action === "close") {
      await host.open();
      await vi.waitFor(() => expect(host.getState().configuredUrl).toBe(url));
      report(currentContents(), { instanceId: "reopened" });
      expect(host.getState().instanceId).toBe("reopened");
      expect(
        electron.ipcMain.listenerCount(remoteInstanceChannels.report),
      ).toBe(listeners);
    }
  },
);

it("ignores a clear confirmation after a detached replacement becomes active", async () => {
  host = createHost(url);
  electron.ipcMain.removeAllListeners();
  host.registerIpc();
  await host.open();
  await connect("https://other.test/");
  const active = currentContents();
  const loading = deferred();
  electron.onLoad.mockReturnValueOnce(loading.promise);
  const resetting = host.reset();
  await vi.waitFor(() => expect(currentContents()).not.toBe(active));
  const replacement = currentContents();
  const confirmation = deferred();
  electron.dialog.showMessageBox.mockImplementationOnce(async () => {
    await confirmation.promise;
    return { response: 1 };
  });

  const clearing = host.clearWithConfirmation();
  loading.resolve();
  await resetting;
  confirmation.resolve();
  await clearing;

  expect(host.getState().configuredUrl).toBe(url);
  expect(replacement.isDestroyed()).toBe(false);
  expect(electron.session.clearStorageData).not.toHaveBeenCalled();
});

testCases.each([false, true])(
  "opens a known link without waiting for hanging startup (configured: %s)",
  async (configured) => {
    const targetUrl = "https://target.test/";
    await store.save({
      url,
      instanceAddresses: [{ url: targetUrl, instanceId: "target" }],
    });
    host = createHost(configured ? url : undefined);
    electron.ipcMain.removeAllListeners();
    host.registerIpc();
    const loading = deferred();
    electron.onLoad.mockReturnValueOnce(loading.promise);

    // open resolves with the shell and registry ready, not the remote page loaded.
    await host.open();
    const restoring = currentContents();
    expect(restoring.loadURL).toHaveBeenCalledWith(url);
    electron.onLoad.mockImplementationOnce(async (contents) => {
      report(contents, { instanceId: "target" });
    });
    await host.routeDeepLink("overmux://target/route");
    const selected = currentContents();
    expect(selected.loadURL).toHaveBeenLastCalledWith(`${targetUrl}route`);
    loading.resolve();
    await vi.waitFor(() => expect(restoring.destroyed).toBe(true));
    await store.load();
    expect(currentContents()).toBe(selected);
    expect(host.getState().configuredUrl).toBe(targetUrl);
    expect(host.getState().error).toBeUndefined();
    expect(
      electron.BrowserWindow.instances.at(-1)!.contentView.addChildView,
    ).toHaveBeenLastCalledWith(electron.WebContentsView.instances.at(-1));
  },
);

it("opens a link when the app was not running and the signed-in page reports identity after loading", async () => {
  await store.save({ url, instanceAddresses: [{ url, instanceId: "work" }] });
  electron.BrowserWindow.instances.at(-1)!.emit("closed");

  const pending = host.routeDeepLink("overmux://work/target");
  await vi.waitFor(() =>
    expect(electron.WebContentsView.instances).toHaveLength(2),
  );
  const contents = currentContents();
  expect(contents.loadURL).toHaveBeenCalledExactlyOnceWith(url);
  report(contents, { instanceId: "work" });
  await pending;

  expect(contents.loadURL).toHaveBeenLastCalledWith(
    "https://overmux.test/target",
  );
  expect(electron.BrowserWindow.instances).toHaveLength(2);
});

it("keeps remembered addresses ready when a newer link arrives while the app is starting", async () => {
  await store.save({ url, instanceAddresses: [{ url, instanceId: "work" }] });
  electron.BrowserWindow.instances.at(-1)!.emit("closed");
  const reading = deferred();
  const loadConfig = store.load.bind(store);
  vi.spyOn(store, "load").mockImplementationOnce(async () => {
    await reading.promise;
    return loadConfig();
  });
  electron.onLoad.mockImplementation(async (contents) => {
    report(contents, { instanceId: "work" });
  });

  const first = host.routeDeepLink("overmux://work/first");
  await vi.waitFor(() => expect(store.load).toHaveBeenCalled());
  const second = host.routeDeepLink("overmux://work/second");
  reading.resolve();
  await Promise.all([first, second]);

  expect(currentContents().executeJavaScript).toHaveBeenCalledWith(
    expect.stringContaining('"https://overmux.test/second"'),
  );
  expect(currentContents().loadURL).not.toHaveBeenCalledWith(
    "https://overmux.test/first",
  );
});

testCases.each(["loading", "discovery", "route"] as const)(
  "a newer link interrupts %s without waiting for an earlier page to finish",
  async (phase) => {
    await connect();
    report(currentContents(), { instanceId: "work" });
    await connect("https://next.test/");
    report(currentContents(), { instanceId: "next" });
    await connect("https://elsewhere.test/");
    const listeners = electron.ipcMain.listenerCount(
      remoteInstanceChannels.report,
    );
    const loading = deferred();
    electron.onLoad.mockImplementationOnce(async (contents) => {
      if (phase !== "discovery") {
        report(contents, { instanceId: "work" });
      }
      if (phase === "loading") {
        await loading.promise;
      }
    });
    if (phase === "route") {
      electron.onLoad.mockReturnValueOnce(loading.promise);
    }

    const first = host.routeDeepLink("overmux://work/first");
    await vi.waitFor(() => {
      expect(currentContents().loadURL).toHaveBeenCalledWith(url);
      if (phase === "discovery") {
        expect(
          electron.ipcMain.listenerCount(remoteInstanceChannels.report),
        ).toBe(listeners + 1);
      }
      if (phase === "route") {
        expect(currentContents().loadURL).toHaveBeenCalledTimes(2);
      }
    });
    const old = currentContents();
    electron.onLoad.mockImplementationOnce(async (contents) => {
      report(contents, { instanceId: "next" });
    });
    await host.routeDeepLink("overmux://next/second");
    await first;

    expect(currentContents().loadURL).toHaveBeenLastCalledWith(
      "https://next.test/second",
    );
    expect(currentContents().loadURL).not.toHaveBeenCalledWith(
      "https://overmux.test/first",
    );
    expect(old.destroyed).toBe(true);
    expect(electron.ipcMain.listenerCount(remoteInstanceChannels.report)).toBe(
      listeners,
    );
    loading.resolve();
  },
);

it("routes an active ID at the active address, not its preferred alias, without confirmation", async () => {
  await connect("https://preferred.test/");
  report(currentContents(), { instanceId: "work" });
  await connect();
  const active = currentContents();
  report(active, { instanceId: "work" });

  const link = "overmux://work/tmux/$71/@647/%25647?overmux-scheme=ftp#";
  // Electron emits this before will-navigate cancels the protocol navigation.
  active.emit("did-start-navigation", {}, link, false, true);
  await host.routeDeepLink(link);

  expect(active.loadURL).toHaveBeenCalledExactlyOnceWith(url);
  expect(active.executeJavaScript).toHaveBeenCalledWith(
    expect.stringContaining(
      '"https://overmux.test/tmux/$71/@647/%25647?overmux-scheme=ftp#"',
    ),
  );
  expect(host.getState().instanceId).toBe("work");
  expect(electron.WebContentsView.instances).toHaveLength(2);
  expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  const window = electron.BrowserWindow.instances.at(-1)!;
  expect(window.show).toHaveBeenCalled();
  expect(window.focus).toHaveBeenCalled();
});

it("a newer same-instance link releases an unfinished in-page navigation without reloading", async () => {
  await connect();
  const active = currentContents();
  report(active, { instanceId: "work" });
  const navigating = deferred();
  active.executeJavaScript.mockReturnValueOnce(navigating.promise);

  const first = host.routeDeepLink("overmux://work/first");
  await vi.waitFor(() =>
    expect(active.executeJavaScript).toHaveBeenCalledTimes(1),
  );
  await host.routeDeepLink("overmux://work/second");
  await first;
  navigating.reject(new Error("old frame execution failed"));
  await Promise.resolve();

  expect(active.executeJavaScript).toHaveBeenLastCalledWith(
    expect.stringContaining('"https://overmux.test/second"'),
  );
  expect(active.loadURL).toHaveBeenCalledExactlyOnceWith(url);
  expect(host.getState().instanceId).toBe("work");
  expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
});

testCases.each(["early", "late"] as const)(
  "confirms the newest known alias and verifies %s identity before routing",
  async (timing) => {
    await connect();
    report(currentContents(), { instanceId: "work" });
    await connect("https://preferred.test/base");
    report(currentContents(), { instanceId: "work" });
    await connect("https://other.test/");
    report(currentContents(), { instanceId: "other" });
    const loading = deferred();
    electron.onLoad.mockImplementationOnce(async (contents) => {
      if (timing === "early") {
        report(contents, { instanceId: "work" });
        await loading.promise;
      }
    });

    const pending = host.routeDeepLink("overmux://work/target?#");
    await vi.waitFor(() =>
      expect(currentContents().loadURL).toHaveBeenCalledWith(
        "https://preferred.test/base",
      ),
    );
    expect(currentContents().loadURL).toHaveBeenCalledTimes(1);
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        message: "Open Overmux instance work at https://preferred.test?",
      }),
    );
    if (timing === "early") {
      loading.resolve();
    } else {
      report(currentContents(), { instanceId: "work" });
    }
    await pending;
    expect(currentContents().loadURL).toHaveBeenLastCalledWith(
      "https://preferred.test/target?#",
    );
  },
);

testCases.each([false, true])(
  "rejects unknown IDs without changing the connection (connected: %s)",
  async (connected) => {
    if (connected) {
      await connect();
      report(currentContents(), { instanceId: "active" });
    }
    const before = host.getState();
    const saved = await store.load();
    const views = [...electron.WebContentsView.instances];

    await host.routeDeepLink("overmux://unknown/private-route?secret=1");

    expect(electron.dialog.showMessageBox).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        detail:
          "Instance unknown isn't known. Connect to it first, then reopen this link.",
      }),
    );
    expect(host.getState()).toEqual(before);
    expect(await store.load()).toEqual(saved);
    expect(electron.WebContentsView.instances).toEqual(views);
    expect(views.every((view) => !view.webContents.isDestroyed())).toBe(true);

    await connect("https://new.test/");
    report(currentContents(), { instanceId: "unknown" });
    expect(currentContents().loadURL).toHaveBeenCalledTimes(1);
    await host.routeDeepLink("overmux://unknown/reopened");
    expect(currentContents().loadURL).toHaveBeenCalledTimes(1);
    expect(currentContents().executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"https://new.test/reopened"'),
    );
  },
);

it("closing cancels a confirmation and queued links cannot reopen the window", async () => {
  await connect();
  report(currentContents(), { instanceId: "work" });
  await connect("https://other.test/");
  const confirmation = deferred();
  electron.dialog.showMessageBox.mockImplementationOnce(
    async (_window, options) => {
      options?.signal?.addEventListener("abort", confirmation.resolve, {
        once: true,
      });
      await confirmation.promise;
      return { response: 1 };
    },
  );
  const pending = host.routeDeepLink("overmux://work/forbidden");
  await vi.waitFor(() =>
    expect(electron.dialog.showMessageBox).toHaveBeenCalled(),
  );
  const queued = host.routeDeepLink("overmux://unknown/also-forbidden");
  electron.BrowserWindow.instances.at(-1)!.emit("closed");
  await Promise.all([pending, queued]);
  confirmation.resolve();
  await Promise.resolve();
  expect(electron.BrowserWindow.instances).toHaveLength(1);
  expect(electron.WebContentsView.instances).toHaveLength(2);
});

testCases.each(["immediate", "after-matching-report"] as const)(
  "updates a mismatching association but never routes the old ID: %s",
  async (timing) => {
    await connect();
    report(currentContents(), { instanceId: "old" });
    await connect("https://elsewhere.test/");
    const loading = deferred();
    electron.onLoad.mockImplementationOnce(async (contents) => {
      report(contents, { instanceId: timing === "immediate" ? "new" : "old" });
      await loading.promise;
    });
    const pending = host.routeDeepLink("overmux://old/forbidden");
    await vi.waitFor(() =>
      expect(currentContents().loadURL).toHaveBeenCalledWith(url),
    );
    const contents = currentContents();
    if (timing === "after-matching-report") {
      report(contents, { instanceId: "new" });
    }
    loading.resolve();
    await pending;
    expect(contents.loadURL).toHaveBeenCalledTimes(1);
    expect((await store.load())?.instanceAddresses[0]).toEqual({
      url,
      instanceId: "new",
    });
    expect(electron.dialog.showMessageBox).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        detail: expect.stringContaining(
          "Expected instance old, but this address reports new",
        ),
      }),
    );
  },
);

it("discards a link after five seconds without identity; signing in requires clicking it again", async () => {
  await connect();
  report(currentContents(), { instanceId: "work" });
  await connect("https://elsewhere.test/");
  const listeners = electron.ipcMain.listenerCount(
    remoteInstanceChannels.report,
  );
  vi.useFakeTimers();

  const pending = host.routeDeepLink("overmux://work/target");
  await vi.waitFor(() =>
    expect(electron.ipcMain.listenerCount(remoteInstanceChannels.report)).toBe(
      listeners + 1,
    ),
  );
  const contents = currentContents();
  await vi.advanceTimersByTimeAsync(5_000);
  await pending;

  expect(electron.dialog.showMessageBox).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      detail: expect.stringContaining("sign in, then click the link again"),
    }),
  );
  expect(contents.destroyed).toBe(false);
  expect(electron.ipcMain.listenerCount(remoteInstanceChannels.report)).toBe(
    listeners,
  );
  expect(vi.getTimerCount()).toBe(0);
  report(contents, { instanceId: "work" });
  await Promise.resolve();
  expect(contents.loadURL).toHaveBeenCalledTimes(1);
  await host.routeDeepLink("overmux://work/target");
  expect(contents.loadURL).toHaveBeenCalledTimes(1);
  expect(contents.executeJavaScript).toHaveBeenCalledWith(
    expect.stringContaining('"https://overmux.test/target"'),
  );
});

it("reports a failed connection without sending the link route", async () => {
  await connect();
  report(currentContents(), { instanceId: "work" });
  await connect("https://elsewhere.test/");
  electron.onLoad.mockRejectedValueOnce(new Error("ERR_CONNECTION_REFUSED"));

  await host.routeDeepLink("overmux://work/forbidden");

  expect(currentContents().loadURL).toHaveBeenCalledExactlyOnceWith(url);
  expect(electron.dialog.showMessageBox).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      detail: expect.stringContaining("ERR_CONNECTION_REFUSED"),
    }),
  );
});

testCases.each(["replace", "reset", "clear", "close"] as const)(
  "invalidates a pending link load on %s and cannot resume it",
  async (action) => {
    if (action === "reset") {
      host = createHost("https://configured.test/");
      electron.ipcMain.removeAllListeners();
      host.registerIpc();
      await host.open();
    }
    await connect();
    report(currentContents(), { instanceId: "work" });
    await connect("https://elsewhere.test/");
    const loading = deferred();
    electron.onLoad.mockImplementationOnce(async (contents) => {
      report(contents, { instanceId: "work" });
      await loading.promise;
    });
    const pending = host.routeDeepLink("overmux://work/forbidden");
    await vi.waitFor(() =>
      expect(currentContents().loadURL).toHaveBeenCalledWith(url),
    );
    const old = currentContents();
    if (action === "replace") {
      await connect("https://replacement.test/");
    } else if (action === "reset") {
      electron.onLoad.mockImplementationOnce(async (contents) => {
        report(contents, { instanceId: "unrelated-reset" });
      });
      await host.reset();
      expect(host.getState().instanceId).toBe("unrelated-reset");
      expect(currentContents().loadURL).toHaveBeenCalledExactlyOnceWith(
        "https://configured.test/",
      );
    } else if (action === "clear") {
      await host.clearWithConfirmation();
    } else if (action === "close") {
      electron.BrowserWindow.instances.at(-1)!.emit("closed");
    }
    await pending;
    loading.resolve();
    await Promise.resolve();
    expect(old.loadURL).toHaveBeenCalledTimes(1);
  },
);
