import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import {
  afterEach,
  beforeEach,
  expect,
  it,
  test as testCases,
  vi,
  type MockInstance,
} from "vitest";

import { remoteInstanceChannels } from "../shared/remote-instance.js";
import type { ConfigStore } from "./config-store.js";

const electron = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const remoteInstanceChannel = "overmux-desktop:instance-report";
  const ipcMain = Object.assign(new EventEmitter(), { handle: vi.fn() });
  const loadURL = vi.fn(async (_url: string): Promise<void> => undefined);
  class WebContents extends EventEmitter {
    mainFrame = { url: "about:blank", detached: false };
    loadURL = vi.fn(async (url: string) => {
      this.emit("did-start-navigation", {}, url, false, true);
      this.mainFrame = { url, detached: false };
      this.emit("did-frame-navigate", {}, url, 200, "OK", true);
      ipcMain.emit(
        remoteInstanceChannel,
        { sender: this, senderFrame: this.mainFrame },
        { instanceId: url.includes("other.test") ? "other" : "rich-work-4242" },
      );
      await loadURL(url);
    });
    destroyed = false;
    close = vi.fn(() => {
      this.destroyed = true;
    });
    reload = vi.fn();
    reloadIgnoringCache = vi.fn();
    focus = vi.fn();
    send = vi.fn();
    isDestroyed = () => this.destroyed;
    setWindowOpenHandler = vi.fn();
  }
  class BrowserWindow extends EventEmitter {
    static instances: BrowserWindow[] = [];
    static getAllWindows = vi.fn(() => []);
    webContents = new WebContents();
    contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
    loadFile = vi.fn(async () => undefined);
    show = vi.fn();
    focus = vi.fn();
    isFocused = () => true;
    isDestroyed = () => false;
    getContentBounds = () => ({ width: 1200, height: 800 });
    setMenuBarVisibility = vi.fn();
    setWindowButtonVisibility = vi.fn();
    constructor() {
      super();
      BrowserWindow.instances.push(this);
    }
  }
  class WebContentsView {
    static instances: WebContentsView[] = [];
    webContents = new WebContents();
    setBounds = vi.fn();
    constructor() {
      WebContentsView.instances.push(this);
    }
  }
  const app = Object.assign(new EventEmitter(), {
    getPath: vi.fn(),
    setPath: vi.fn(),
    whenReady: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    setAsDefaultProtocolClient: vi.fn(),
  });
  const dialog = { showMessageBox: vi.fn(), showErrorBox: vi.fn() };
  const remoteSession = Object.assign(new EventEmitter(), {
    clearCache: vi.fn(async (): Promise<void> => undefined),
    clearStorageData: vi.fn(),
  });
  return {
    app,
    loadURL,
    BrowserWindow,
    dialog,
    WebContentsView,
    ipcMain,
    Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
    remoteSession,
    session: { fromPartition: vi.fn(() => remoteSession) },
  };
});

vi.mock("electron", () => electron);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const initialArgv = process.argv;
const testDirectory = resolve(import.meta.dirname, "../../../../.test-tmp");
let fixtureDirectory: string;
let directory: string;
let ready: ReturnType<typeof deferred<void>>;
let configSave: MockInstance<ConfigStore["save"]>;
const finishConfigWrites = () =>
  Promise.all(configSave.mock.results.map((result) => result.value));
const link = "overmux://rich-work-4242/tmux/$71/@647/%25647";
const address = "http://localhost:4242/";
const localDestination = `${address}tmux/$71/@647/%25647`;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const { ConfigStore } = await import("./config-store.js");
  configSave = vi.spyOn(ConfigStore.prototype, "save");
  electron.loadURL.mockReset().mockResolvedValue(undefined);
  electron.app.removeAllListeners();
  electron.ipcMain.removeAllListeners();
  electron.remoteSession.removeAllListeners();
  electron.remoteSession.clearCache.mockReset().mockResolvedValue(undefined);
  electron.BrowserWindow.instances.length = 0;
  electron.WebContentsView.instances.length = 0;
  await mkdir(testDirectory, { recursive: true });
  fixtureDirectory = await mkdtemp(resolve(testDirectory, "desktop-"));
  const stateHome = resolve(fixtureDirectory, "state");
  vi.stubEnv("XDG_STATE_HOME", stateHome);
  directory = resolve(stateHome, "overmux/desktop");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "desktop-config.json"),
    JSON.stringify({
      instanceAddresses: [{ url: address, instanceId: "rich-work-4242" }],
    }),
  );
  const paths = new Map<string, string>();
  electron.app.setPath.mockImplementation((name: string, path: string) => {
    paths.set(name, path);
  });
  electron.app.getPath.mockImplementation((name: string) => paths.get(name));
  ready = deferred<void>();
  electron.app.whenReady.mockReturnValue(ready.promise);
  electron.dialog.showMessageBox.mockResolvedValue({ response: 1 });
  vi.stubEnv("OVERMUX_SERVER_URL", undefined);
  vi.stubEnv("OVERMUX_DESKTOP_SMOKE_TEST", undefined);
  vi.stubEnv("OVERMUX_ELECTRON_GPU_DIAGNOSTICS", undefined);
  process.argv = [
    "electron",
    "overmux",
    "--desktop-config",
    `${directory}/missing.ts`,
  ];
});

afterEach(async () => {
  await finishConfigWrites();
  process.argv = initialArgv;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(fixtureDirectory, { recursive: true, force: true });
});

const start = async () => {
  await import("./index.js");
  ready.resolve();
  await vi.waitFor(() =>
    expect(electron.BrowserWindow.instances).toHaveLength(1),
  );
};

const expectLoaded = async (destination: string) => {
  await vi.waitFor(() =>
    expect(
      electron.WebContentsView.instances.at(-1)?.webContents.loadURL,
    ).toHaveBeenLastCalledWith(destination),
  );
  // Saving the selected instance precedes attaching and focusing its view.
  await vi.waitFor(() =>
    expect(
      electron.BrowserWindow.instances.at(-1)?.contentView.addChildView,
    ).toHaveBeenCalledWith(electron.WebContentsView.instances.at(-1)),
  );
  // Identity reports queue disk snapshots after navigation; fixture edits must follow them.
  await finishConfigWrites();
};

it("creates the XDG desktop profile before locking or initializing sessions", async () => {
  await rm(resolve(fixtureDirectory, "state"), { recursive: true });

  await import("./index.js");

  expect((await stat(directory)).isDirectory()).toBe(true);
  expect(electron.app.setPath.mock.calls).toEqual([
    ["userData", directory],
    ["sessionData", directory],
  ]);
  expect(electron.app.setPath).toHaveBeenCalledBefore(
    electron.app.requestSingleInstanceLock,
  );
  expect(electron.app.setPath).toHaveBeenCalledBefore(electron.app.whenReady);
  expect(electron.session.fromPartition).not.toHaveBeenCalled();
  ready.resolve();
  await vi.waitFor(() =>
    expect(electron.session.fromPartition).toHaveBeenCalledWith(
      "persist:overmux-remote",
    ),
  );
});

it("lets a newer link supersede the launch link while its confirmation is open", async () => {
  // Keep this fixture's report on the real bridge channel, not a host method.
  expect(remoteInstanceChannels.report).toBe("overmux-desktop:instance-report");
  process.argv.push(link);
  const confirmation = deferred<{ response: number }>();
  electron.dialog.showMessageBox.mockReturnValueOnce(confirmation.promise);
  await import("./index.js");
  ready.resolve();
  await vi.waitFor(() =>
    expect(electron.dialog.showMessageBox).toHaveBeenCalledOnce(),
  );
  electron.app.emit("second-instance", {}, [
    "electron",
    "overmux://rich-work-4242/next",
  ]);
  expect(electron.WebContentsView.instances).toHaveLength(0);
  confirmation.resolve({ response: 1 });
  await expectLoaded(`${address}next`);
  expect(electron.WebContentsView.instances).toHaveLength(1);
  expect(
    electron.WebContentsView.instances[0]!.webContents.loadURL.mock.calls.map(
      ([url]) => url,
    ),
  ).toEqual([address, `${address}next`]);
  expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(2);
});

it("uses the newest macOS link received before the app is ready", async () => {
  await import("./index.js");
  const event = { preventDefault: vi.fn() };
  electron.app.emit("open-url", event, "overmux://unknown/secret");
  electron.app.emit("open-url", event, link);
  ready.resolve();
  await expectLoaded(localDestination);
  expect(electron.dialog.showMessageBox).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    expect.objectContaining({
      message: "Open Overmux instance rich-work-4242 at http://localhost:4242?",
    }),
  );
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
  expect(electron.dialog.showErrorBox).not.toHaveBeenCalled();
});

const clickInstanceAction = (label: string) => {
  const template = electron.Menu.buildFromTemplate.mock.calls.at(-1)?.[0] as {
    label?: string;
    submenu?: { label?: string; click?: () => void }[];
  }[];
  const action = template
    .find((item) => item.label === "Instance")
    ?.submenu?.find((item) => item.label === label);
  expect(action?.click).toBeTypeOf("function");
  action?.click?.();
};

const reset = () => clickInstanceAction("Reset Overmux to Configured Server");
const saveUrl = (url: string) =>
  writeFile(
    `${directory}/desktop-config.json`,
    JSON.stringify({
      url,
      instanceAddresses: [
        { url: "https://other.test/selected", instanceId: "other" },
      ],
    }),
  );

testCases.each([
  {
    name: "environment overrides saved configuration",
    env: "http://env.test/start",
    expected: "http://env.test/start",
  },
  {
    name: "saved configuration without environment",
    env: undefined,
    expected: "http://saved.test/start",
  },
  {
    name: "empty environment restores saved configuration",
    env: "",
    expected: "http://saved.test/start",
  },
])(
  "shares URL precedence for startup, reopen, and reset: $name",
  async ({ env, expected }) => {
    vi.stubEnv("OVERMUX_SERVER_URL", env);
    await saveUrl("http://saved.test/start");
    await start();
    await expectLoaded(expected);
    expect(electron.remoteSession.clearCache).not.toHaveBeenCalled();

    electron.BrowserWindow.instances[0]?.emit("closed");
    electron.app.emit("activate");
    await vi.waitFor(() =>
      expect(electron.BrowserWindow.instances).toHaveLength(2),
    );
    await expectLoaded(expected);
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();

    // A deep link can change the active configuration and saved URL, not the env source.
    electron.app.emit("second-instance", {}, ["overmux://other/selected"]);
    await expectLoaded("https://other.test/selected");
    const active = electron.WebContentsView.instances.at(-1)!;
    clickInstanceAction("Reload Overmux");
    expect(active.webContents.reload).toHaveBeenCalledOnce();
    expect(active.webContents.loadURL).toHaveBeenCalledTimes(2);
    expect(electron.remoteSession.clearCache).not.toHaveBeenCalled();

    const cacheCleared = deferred<void>();
    electron.remoteSession.clearCache.mockReturnValueOnce(cacheCleared.promise);
    const viewCount = electron.WebContentsView.instances.length;
    reset();
    reset();
    await vi.waitFor(() =>
      expect(electron.remoteSession.clearCache).toHaveBeenCalledOnce(),
    );
    expect(electron.WebContentsView.instances).toHaveLength(viewCount);
    expect(active.webContents.close).not.toHaveBeenCalled();
    cacheCleared.resolve();

    await vi.waitFor(() =>
      expect(electron.WebContentsView.instances).toHaveLength(viewCount + 1),
    );
    await expectLoaded(env || "https://other.test/selected");
    const fresh = electron.WebContentsView.instances.at(-1)!;
    expect(fresh.webContents.loadURL).toHaveBeenCalledOnce();
    expect(fresh.webContents.reload).not.toHaveBeenCalled();
    expect(fresh.webContents.reloadIgnoringCache).not.toHaveBeenCalled();
    expect(active.webContents.close).toHaveBeenCalledOnce();
    expect(electron.dialog.showMessageBox).toHaveBeenCalledOnce();
    expect(electron.remoteSession.clearStorageData).not.toHaveBeenCalled();
    expect(
      JSON.parse(await readFile(`${directory}/desktop-config.json`, "utf8")),
    ).toEqual({
      url: env || "https://other.test/selected",
      instanceAddresses: [
        ...(env ? [{ url: env, instanceId: "rich-work-4242" }] : []),
        { url: "https://other.test/selected", instanceId: "other" },
        { url: expected, instanceId: "rich-work-4242" },
      ].filter(
        (entry, index, entries) =>
          entries.findIndex((other) => other.url === entry.url) === index,
      ),
    });
  },
);

testCases.each([undefined, "file:///unsafe"])(
  "returns to the connection screen when saved URL is %s",
  async (url) => {
    process.argv.push(link);
    await start();
    await expectLoaded(localDestination);
    const active = electron.WebContentsView.instances.at(-1)!;
    const viewCount = electron.WebContentsView.instances.length;
    if (url) {
      await saveUrl(url);
    } else {
      await rm(`${directory}/desktop-config.json`);
    }

    reset();

    await vi.waitFor(() =>
      expect(active.webContents.close).toHaveBeenCalledOnce(),
    );
    expect(electron.WebContentsView.instances).toHaveLength(viewCount);
    expect(
      electron.BrowserWindow.instances.at(-1)?.webContents.send,
    ).toHaveBeenLastCalledWith("overmux-desktop:state", {
      configuredUrl: undefined,
      instanceId: undefined,
      error: undefined,
    });
  },
);

it("reports cache-clear failure without navigating and allows a subsequent reset", async () => {
  vi.stubEnv("OVERMUX_SERVER_URL", "https://env.test/start");
  await start();
  await expectLoaded("https://env.test/start");
  electron.remoteSession.clearCache.mockRejectedValueOnce(
    new Error("cache unavailable"),
  );

  reset();

  await vi.waitFor(() =>
    expect(
      electron.BrowserWindow.instances[0]?.webContents.send,
    ).toHaveBeenLastCalledWith("overmux-desktop:state", {
      configuredUrl: "https://env.test/start",
      instanceId: "rich-work-4242",
      error: "Could not reset Overmux: cache unavailable",
    }),
  );
  expect(electron.WebContentsView.instances).toHaveLength(1);
  reset();
  await vi.waitFor(() =>
    expect(electron.WebContentsView.instances).toHaveLength(2),
  );
  await expectLoaded("https://env.test/start");
});

it("discards a reset candidate if its window closes before loading finishes", async () => {
  vi.stubEnv("OVERMUX_SERVER_URL", "https://env.test/start");
  await start();
  await expectLoaded("https://env.test/start");
  const loaded = deferred<void>();
  electron.loadURL.mockReturnValueOnce(loaded.promise);
  reset();
  await vi.waitFor(() =>
    expect(electron.WebContentsView.instances).toHaveLength(2),
  );
  const candidate = electron.WebContentsView.instances[1]!;
  const window = electron.BrowserWindow.instances[0]!;
  window.emit("closed");
  expect(candidate.webContents.close).toHaveBeenCalledOnce();
  loaded.resolve();

  await vi.waitFor(() =>
    expect(candidate.webContents.close).toHaveBeenCalledOnce(),
  );
  expect(window.contentView.addChildView).toHaveBeenCalledOnce();
});

it("keeps the active view and closes a failed environment reset candidate", async () => {
  vi.stubEnv("OVERMUX_SERVER_URL", "https://env.test/start");
  await start();
  await expectLoaded("https://env.test/start");
  const active = electron.WebContentsView.instances[0]!;
  electron.loadURL.mockRejectedValueOnce(new Error("offline"));

  reset();

  await vi.waitFor(() =>
    expect(
      electron.BrowserWindow.instances[0]?.webContents.send,
    ).toHaveBeenLastCalledWith("overmux-desktop:state", {
      configuredUrl: "https://env.test/start",
      instanceId: "rich-work-4242",
      error:
        "Could not reset Overmux: Could not load configured Overmux: offline",
    }),
  );
  expect(
    electron.WebContentsView.instances[1]?.webContents.close,
  ).toHaveBeenCalledOnce();
  expect(active.webContents.close).not.toHaveBeenCalled();
});
