// DesktopApp owns the local window, menus, dialogs, saved addresses, and link routing policy.
// ServerPage owns the embedded website's loading, identity, and replacement lifecycle.
import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type Session,
  type WebContents,
} from "electron";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  connectRequestSchema,
  ipcChannels,
  type ConnectRequest,
  type ConnectResult,
  type HostState,
  type SavedConfig,
} from "../shared/contracts.js";
import { installApplicationMenu } from "./application-menu.js";
import { ConfigStore } from "./config-store.js";
import type { DesktopConfig } from "./desktop-config.js";
import { ServerPage } from "./server-page.js";
import { guardTrustedShell } from "./trusted-shell.js";
import {
  decideNavigation,
  getOrigin,
  isPlainHttp,
  normalizeHttpUrl,
  parseDeepLink,
} from "./url-policy.js";
import { getWindowChrome } from "./window-chrome.js";

const formatError = (error: unknown) =>
  error instanceof Error ? error.message : "An unexpected error occurred.";

export class DesktopApp {
  readonly #config: DesktopConfig;
  readonly #configStore: ConfigStore;
  readonly #remoteSession: Session;
  readonly #serverPage: ServerPage;
  // The launch-time override stays separate from connections selected by deep links.
  readonly #serverUrl: string | undefined;
  #resetting = false;
  #instanceAddresses: SavedConfig["instanceAddresses"] = [];
  // Address selection can wait for disk or a dialog; newer user actions supersede it.
  #selectionRevision = 0;
  #windowGeneration = 0;
  #deepLinks: Promise<void> = Promise.resolve();
  #pendingLink: AbortController | undefined;
  #error: string | undefined;
  #window: BrowserWindow | undefined;

  constructor({
    config,
    configStore,
    remoteSession,
    serverUrl,
  }: {
    config: DesktopConfig;
    configStore: ConfigStore;
    remoteSession: Session;
    serverUrl?: string;
  }) {
    this.#config = config;
    this.#configStore = configStore;
    this.#remoteSession = remoteSession;
    this.#serverUrl = serverUrl;
    this.#serverPage = new ServerPage({
      remoteSession,
      getWindow: () => this.#window,
      onSelected: (selection) => this.#rememberSelection(selection),
      onIdentity: (identity) => this.#rememberIdentity(identity),
      onState: () => this.#emitState(),
      onDeepLink: (url) => void this.routeDeepLink(url),
      onExternal: (url) => this.#openExternal(url),
    });
  }

  async open() {
    if (this.#window) {
      return;
    }
    const shellDocumentPath = join(
      import.meta.dirname,
      "../renderer/index.html",
    );
    const chrome = getWindowChrome(this.#config);
    this.#window = new BrowserWindow({
      autoHideMenuBar: chrome.autoHideMenuBar,
      height: 800,
      minHeight: 480,
      minWidth: 640,
      show: false,
      title: "Overmux",
      titleBarStyle: chrome.titleBarStyle,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(import.meta.dirname, "preload.cjs"),
        sandbox: true,
      },
      width: 1200,
    });
    if (chrome.menuBarVisible !== undefined) {
      this.#window.setMenuBarVisibility(chrome.menuBarVisible);
    }
    if (chrome.macosTrafficLightsVisible !== undefined) {
      this.#window.setWindowButtonVisibility(chrome.macosTrafficLightsVisible);
    }
    this.#window.on("resize", () => this.#serverPage.layout());
    this.#window.on("focus", () => this.#serverPage.focus());
    this.#window.on("closed", () => {
      this.#window = undefined;
      this.#windowGeneration += 1;
      this.#selectionRevision += 1;
      this.cancelDeepLink();
      this.#serverPage.close();
    });
    this.#window.once("ready-to-show", () => this.#window?.show());
    this.#window.webContents.on("did-finish-load", () => this.#emitState());
    guardTrustedShell(
      this.#window.webContents,
      pathToFileURL(shellDocumentPath).toString(),
    );
    await this.#window.loadFile(shellDocumentPath);
    await this.#restoreConfigured({ waitForLoad: false });
  }

  async #restoreConfigured({ waitForLoad = true } = {}) {
    const window = this.#window;
    if (!window) {
      return;
    }
    const revision = this.#selectionRevision;
    const saved = await this.#configStore.load();
    if (this.#window !== window || revision !== this.#selectionRevision) {
      return;
    }
    this.#instanceAddresses = saved?.instanceAddresses ?? [];
    this.#selectionRevision += 1;
    const url = this.#serverUrl || saved?.url;
    if (url) {
      const loading = this.#serverUrl
        ? this.#serverPage.load({ url, display: "after-load" })
        : this.#restore(url);
      if (waitForLoad) {
        await loading;
      } else {
        // Shell and registry readiness must not wait for an unrelated remote page.
        // Incoming links can replace this view while restoration is still loading.
        void loading.catch((error: unknown) => {
          this.#error = formatError(error);
          this.#emitState();
        });
      }
      return;
    }
    this.#serverPage.clear();
    this.#error = undefined;
    this.#emitState();
  }

  registerIpc() {
    ipcMain.handle(ipcChannels.getState, (event) => {
      this.#assertTrustedSender(event.sender);
      return this.getState();
    });
    ipcMain.handle(ipcChannels.connect, (event, input: unknown) => {
      this.#assertTrustedSender(event.sender);
      return this.connect(connectRequestSchema.parse(input));
    });
    this.#serverPage.registerIpc();
  }

  configureRemoteSession() {
    this.#remoteSession.on("will-download", (event, item) => {
      event.preventDefault();
      void this.#openExternal(item.getURL());
    });
  }

  installMenu() {
    installApplicationMenu({
      clear: () => void this.clearWithConfirmation(),
      logout: () => void this.#serverPage.openLogout(),
      openDeveloperTools: this.#serverPage.openDeveloperTools,
      openSettings: () => void this.#serverPage.openSettings(),
      reload: this.#serverPage.reload,
      reset: () => void this.reset(),
    });
  }

  getState(): HostState {
    const state = this.#serverPage.getState();
    return { ...state, error: this.#error ?? state.error };
  }

  async connect(request: ConnectRequest): Promise<ConnectResult> {
    let normalized: string;
    try {
      normalized = normalizeHttpUrl(request.url);
    } catch (error) {
      return { message: formatError(error), status: "error" };
    }
    if (isPlainHttp(normalized) && !request.allowInsecure) {
      return {
        origin: getOrigin(normalized),
        status: "requires-http-confirmation",
        url: normalized,
      };
    }
    this.cancelDeepLink();
    this.#selectionRevision += 1;
    this.#error = undefined;
    try {
      await this.#serverPage.load({ url: normalized, display: "immediately" });
    } catch (error) {
      return {
        message: `Could not connect to Overmux: ${formatError(error)}`,
        status: "error",
      };
    }
    return { status: "connected" };
  }

  #saveConfig() {
    return this.#configStore.save({
      url: this.#serverPage.getState().configuredUrl,
      instanceAddresses: this.#instanceAddresses,
    });
  }

  #rememberSelection({
    url,
    display,
  }: {
    url: string;
    display: "immediately" | "after-load";
  }) {
    // A completed replacement also invalidates dialogs opened while it was loading.
    this.#selectionRevision += 1;
    this.#error = undefined;
    if (display === "after-load") {
      return;
    }
    const known = this.#instanceAddresses.find((entry) => entry.url === url);
    if (known) {
      this.#instanceAddresses = [
        known,
        ...this.#instanceAddresses.filter((entry) => entry.url !== url),
      ];
    }
    return this.#saveConfig();
  }

  #rememberIdentity({ url, instanceId }: { url: string; instanceId: string }) {
    this.#instanceAddresses = [
      { url, instanceId },
      ...this.#instanceAddresses.filter((entry) => entry.url !== url),
    ];
    // Snapshot synchronously so a replacement or clear queues after this report.
    const revision = this.#selectionRevision;
    void this.#saveConfig().catch((error: unknown) => {
      if (revision === this.#selectionRevision) {
        this.#error = `Could not remember Overmux identity: ${formatError(error)}`;
        this.#emitState();
      }
    });
  }

  async reset() {
    const window = this.#window;
    if (!window || this.#resetting) {
      return;
    }
    this.#resetting = true;
    this.cancelDeepLink();
    const revision = ++this.#selectionRevision;
    try {
      // Clear only HTTP cache, not credentials or origin storage. Await this before
      // the single navigation so both the document and its assets are fetched fresh.
      await this.#remoteSession.clearCache();
      if (this.#window === window && revision === this.#selectionRevision) {
        await this.#restoreConfigured();
      }
    } catch (error) {
      if (this.#window === window) {
        this.#error = `Could not reset Overmux: ${formatError(error)}`;
        this.#emitState();
      }
    } finally {
      this.#resetting = false;
    }
  }

  async clearWithConfirmation() {
    const url = this.#serverPage.getState().configuredUrl;
    if (!url || !this.#window) {
      this.cancelDeepLink();
      return;
    }
    const revision = this.#selectionRevision;
    const { response } = await dialog.showMessageBox(this.#window, {
      buttons: ["Cancel", "Clear instance"],
      cancelId: 0,
      defaultId: 0,
      detail:
        "This removes the saved URL and this origin's cookies, local storage, IndexedDB, and service workers. The dedicated Overmux remote-session cache is also cleared.",
      message: `Clear ${getOrigin(url)}?`,
      type: "warning",
    });
    if (response !== 1 || revision !== this.#selectionRevision) {
      return;
    }
    await this.#clearConfiguredInstance(url);
  }

  routeDeepLink(input: string) {
    // A new link cancels earlier work, including a hanging page load. Serialize the
    // dialog cleanup so only one link decides which connection to replace at a time.
    this.cancelDeepLink();
    const controller = new AbortController();
    this.#pendingLink = controller;
    const generation = this.#windowGeneration;
    const pending = this.#deepLinks.then(async () => {
      try {
        if (
          !controller.signal.aborted &&
          generation === this.#windowGeneration
        ) {
          await this.#routeDeepLink(input, controller.signal);
        }
      } finally {
        if (this.#pendingLink === controller) {
          this.#pendingLink = undefined;
        }
      }
    });
    this.#deepLinks = pending.catch(() => undefined);
    return pending;
  }

  async #routeDeepLink(input: string, signal: AbortSignal) {
    let link;
    try {
      link = parseDeepLink(input);
    } catch (error) {
      await this.#showDeepLinkError(formatError(error), signal);
      return;
    }
    if (!this.#window) {
      await this.open();
    }
    if (!this.#window || signal.aborted) {
      return;
    }
    const current = this.#serverPage.getState();
    const isActive =
      current.instanceId === link.instanceId && Boolean(current.configuredUrl);
    const url = isActive
      ? current.configuredUrl
      : this.#instanceAddresses.find(
          (entry) => entry.instanceId === link.instanceId,
        )?.url;
    if (!url) {
      await this.#showDeepLinkError(
        `Instance ${link.instanceId} isn't known. Connect to it first, then reopen this link.`,
        signal,
      );
      return;
    }
    this.#selectionRevision += 1;
    // A detached startup/reset candidate must not later replace this link's view.
    this.#serverPage.cancelPendingLoad();
    this.#error = undefined;
    try {
      if (
        !isActive &&
        !(await this.#confirmDeepLinkReplacement(url, link.instanceId, signal))
      ) {
        return;
      }
      signal.throwIfAborted();
      this.#window?.show();
      this.#window?.focus();
      await this.#serverPage.openLink({
        url,
        expectedInstanceId: link.instanceId,
        route: link.route,
        replaceConnection: !isActive,
        signal,
      });
    } catch (error) {
      if (!signal.aborted) {
        this.#selectionRevision += 1;
        await this.#showDeepLinkError(formatError(error), signal);
      }
    }
  }

  cancelDeepLink() {
    this.#pendingLink?.abort();
  }

  #assertTrustedSender(sender: WebContents) {
    if (!this.#window || sender !== this.#window.webContents) {
      throw new Error("Rejected IPC from an untrusted renderer.");
    }
  }

  async #restore(url: string) {
    let normalized: string;
    try {
      normalized = normalizeHttpUrl(url);
    } catch {
      this.#serverPage.clear();
      this.#error = undefined;
      this.#emitState();
      await this.#saveConfig();
      return;
    }
    this.#error = undefined;
    try {
      await this.#serverPage.load({ url: normalized, display: "immediately" });
    } catch {
      // The selected view keeps its load error visible and can be reloaded.
    }
  }

  async #clearConfiguredInstance(configuredUrl: string) {
    this.cancelDeepLink();
    this.#serverPage.clear();
    this.#selectionRevision += 1;
    this.#instanceAddresses = this.#instanceAddresses.filter(
      (entry) => entry.url !== configuredUrl,
    );
    this.#error = undefined;
    const revision = this.#selectionRevision;
    const saved = this.#instanceAddresses.length
      ? this.#saveConfig()
      : this.#configStore.clear();
    this.#emitState();
    await saved;
    try {
      await this.#remoteSession.clearStorageData({
        origin: getOrigin(configuredUrl),
        storages: [
          "cookies",
          "filesystem",
          "indexdb",
          "localstorage",
          "serviceworkers",
          "cachestorage",
        ],
      });
      await this.#remoteSession.clearCache();
    } catch (error) {
      if (revision === this.#selectionRevision) {
        this.#error = `The instance was removed, but some browser data could not be cleared: ${formatError(error)}`;
        this.#emitState();
      }
    }
  }

  async #openExternal(input: string) {
    const url = this.#serverPage.getState().configuredUrl;
    const decision = decideNavigation(input, url ? getOrigin(url) : "");
    if (decision.type === "deny" || decision.type === "deep-link") {
      return;
    }
    if (decision.type === "external" && decision.url.startsWith("file:")) {
      await shell.openPath(fileURLToPath(decision.url));
      return;
    }
    await shell.openExternal(input);
  }

  async #confirmDeepLinkReplacement(
    url: string,
    instanceId: string,
    signal: AbortSignal,
  ) {
    if (!this.#window) {
      return false;
    }
    const origin = getOrigin(url);
    const configuredUrl = this.#serverPage.getState().configuredUrl;
    const current = configuredUrl
      ? `This replaces ${getOrigin(configuredUrl)}.`
      : "This configures the desktop app.";
    const insecure = origin.startsWith("http:")
      ? " This origin uses plain HTTP, so traffic and credentials are not encrypted."
      : "";
    const { response } = await dialog.showMessageBox(this.#window, {
      buttons: ["Cancel", "Use this instance"],
      cancelId: 0,
      defaultId: 0,
      detail: `${current}${insecure}`,
      message: `Open Overmux instance ${instanceId} at ${origin}?`,
      signal,
      type: "warning",
    });
    return response === 1;
  }

  async #showDeepLinkError(message: string, signal: AbortSignal) {
    if (!this.#window || signal.aborted) {
      return;
    }
    await dialog.showMessageBox(this.#window, {
      detail: message,
      message: "Could not open Overmux link",
      signal,
      type: "error",
    });
  }

  #emitState() {
    const window = this.#window;
    if (!window || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(ipcChannels.state, this.getState());
  }
}
