// ServerPage owns the embedded website's loading, authenticated identity, view replacement,
// and stale-work cancellation. DesktopApp owns address selection, dialogs, and persistence.
import {
  ipcMain,
  type BrowserWindow,
  type Session,
  type WebContentsView,
} from "electron";
import { join } from "node:path";

import {
  navigateToOvermuxLogout,
  navigateToOvermuxSettings,
} from "./hosted-navigation.js";
import { navigateInPage } from "./in-page-navigation.js";
import { installInstanceReportIpc } from "./instance-report-ipc.js";
import { installRemoteClipboard } from "./remote-clipboard.js";
import { installRemoteNotifications } from "./remote-notifications.js";
import { createRemoteView } from "./remote-view.js";
import {
  decideNavigation,
  getOrigin,
  normalizeHttpUrl,
  resolveDeepLinkRoute,
} from "./url-policy.js";

type PageDisplay = "immediately" | "after-load";
type ServerPageOptions = {
  remoteSession: Session;
  getWindow: () => BrowserWindow | undefined;
  // Called synchronously at selection; the caller snapshots and serializes persistence.
  // Only immediate selection reorders known addresses without an identity report.
  onSelected: (selection: {
    url: string;
    display: PageDisplay;
  }) => void | Promise<void>;
  onIdentity: (identity: { url: string; instanceId: string }) => void;
  onState: () => void;
  onDeepLink: (url: string) => void;
  onExternal: (url: string) => Promise<void>;
};

type OwnedPage = {
  view: WebContentsView;
  url: string;
  controller: AbortController;
  hasActiveDocument: boolean;
  instanceId?: string;
  disposeListeners: () => void;
};

type PendingLoad = {
  page: OwnedPage;
  dispose: () => void;
};

// When a link launches the desktop app while it is not running, saved credentials
// may already sign the user in, but the website still needs to report its identity.
// Allow a short discovery wait after loading, also when switching servers, not a
// sign-in workflow. On timeout, discard the route; the user must click the link again.
const identityDiscoveryTimeoutMs = 5_000;
const formatError = (error: unknown) =>
  error instanceof Error ? error.message : "An unexpected error occurred.";

// Closing Electron contents does not guarantee a hanging loadURL promise settles.
// Release our wait independently and remove its abort listener on every outcome.
const waitForPage = async (
  page: OwnedPage,
  loading: Promise<unknown>,
  requestSignal?: AbortSignal,
) => {
  const signal = requestSignal
    ? AbortSignal.any([page.controller.signal, requestSignal])
    : page.controller.signal;
  let release = () => {};
  const cancelled = new Promise<void>((resolve) => {
    release = resolve;
    signal.addEventListener("abort", release, { once: true });
    if (signal.aborted) {
      resolve();
    }
  });
  try {
    await Promise.race([loading, cancelled]);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", release);
  }
};

export class ServerPage {
  readonly #options: ServerPageOptions;
  #active: OwnedPage | undefined;
  #candidate: PendingLoad | undefined;
  #loadGeneration = 0;
  #configuredUrl: string | undefined;
  #error: string | undefined;
  #disposeIpc: (() => void) | undefined;

  constructor(options: ServerPageOptions) {
    this.#options = options;
  }

  registerIpc = () => {
    if (this.#disposeIpc) {
      return;
    }
    const getConfiguredUrl = () => this.#configuredUrl;
    const getRemoteView = () => this.#active?.view;
    const disposers = [
      installInstanceReportIpc({
        getConfiguredUrl,
        getRemoteView: () =>
          this.#active?.hasActiveDocument ? this.#active.view : undefined,
        ipcMain,
        onReport: this.#reportIdentity,
      }),
      installRemoteClipboard({ getConfiguredUrl, getRemoteView, ipcMain }),
      installRemoteNotifications({
        getConfiguredUrl,
        getRemoteView,
        getWindow: this.#options.getWindow,
        ipcMain,
        openExternal: this.#options.onExternal,
      }),
    ];
    this.#disposeIpc = () => disposers.forEach((dispose) => dispose());
  };

  getState = (): {
    configuredUrl?: string;
    instanceId?: string;
    error?: string;
  } => ({
    configuredUrl: this.#configuredUrl,
    instanceId: this.#active?.instanceId,
    error: this.#error,
  });

  load = async ({ url, display }: { url: string; display: PageDisplay }) => {
    const normalized = normalizeHttpUrl(url);
    this.cancelPendingLoad();
    if (!this.#options.getWindow()) {
      return;
    }
    return display === "immediately"
      ? this.#loadImmediately(normalized)
      : this.#loadAfterSuccess(normalized);
  };

  #loadImmediately = async (url: string, signal?: AbortSignal) => {
    const page = this.#createPage(url);
    // Select before load: authenticated reports can arrive before loadURL resolves.
    // A replacement owns all later state; an old completion must never reattach.
    try {
      const saved = this.#attach(page, "immediately");
      await waitForPage(
        page,
        Promise.all([saved, page.view.webContents.loadURL(url)]),
        signal,
      );
      this.#assertActive(page);
    } catch (error) {
      if (
        this.#active === page &&
        !page.view.webContents.isDestroyed() &&
        !signal?.aborted
      ) {
        this.#error = `Overmux failed to load: ${formatError(error)}`;
        this.#options.onState();
      }
      throw error;
    }
  };

  #loadAfterSuccess = async (url: string) => {
    const window = this.#options.getWindow();
    const generation = this.#loadGeneration;
    const page = this.#createPage(url);
    // The new page may report its server ID before it finishes loading.
    // Remember that ID, but publish it only after this view is successfully attached.
    // Discard it if the page navigates again, crashes, or another connection replaces it.
    const removeIdentityListener = installInstanceReportIpc({
      getConfiguredUrl: () => url,
      getRemoteView: () =>
        this.#candidate?.page === page && page.hasActiveDocument
          ? page.view
          : undefined,
      ipcMain,
      onReport: (instanceId) => {
        page.instanceId = instanceId;
      },
    });
    const cancel = () => {
      if (this.#candidate?.page === page) {
        this.cancelPendingLoad();
      }
    };
    const dispose = () => {
      removeIdentityListener();
      window?.removeListener("closed", cancel);
      page.view.webContents.removeListener("destroyed", cancel);
    };
    this.#candidate = { page, dispose };
    // A configured load is detached until it succeeds. Closing the window must
    // also close this candidate, even if the server never finishes responding.
    window?.once("closed", cancel);
    page.view.webContents.once("destroyed", cancel);
    try {
      await waitForPage(page, page.view.webContents.loadURL(url));
      if (
        this.#candidate?.page !== page ||
        generation !== this.#loadGeneration ||
        this.#options.getWindow() !== window ||
        page.view.webContents.isDestroyed()
      ) {
        return;
      }
      dispose();
      this.#candidate = undefined;
      const saved = this.#attach(page, "after-load");
      // Publish without yielding after selection, while this document still owns the report.
      if (
        this.#active === page &&
        page.hasActiveDocument &&
        !page.view.webContents.isDestroyed() &&
        page.instanceId
      ) {
        this.#reportIdentity(page.instanceId);
      }
      await saved;
    } catch (error) {
      if (
        generation !== this.#loadGeneration ||
        this.#options.getWindow() !== window
      ) {
        return;
      }
      throw new Error(
        `Could not load configured Overmux: ${formatError(error)}`,
      );
    } finally {
      dispose();
      if (this.#candidate?.page === page) {
        this.#candidate = undefined;
      }
      if (this.#active !== page) {
        this.#disposePage(page);
      }
    }
  };

  cancelPendingLoad = () => {
    this.#loadGeneration += 1;
    const candidate = this.#candidate;
    this.#candidate = undefined;
    if (!candidate) {
      return;
    }
    candidate.dispose();
    this.#disposePage(candidate.page);
  };

  openLink = async ({
    url,
    expectedInstanceId,
    route,
    replaceConnection,
    signal,
  }: {
    url: string;
    expectedInstanceId: string;
    route: string;
    replaceConnection: boolean;
    signal: AbortSignal;
  }) => {
    signal.throwIfAborted();
    if (!this.#options.getWindow()) {
      throw new Error("Connection was replaced or closed.");
    }
    const normalized = normalizeHttpUrl(url);
    this.cancelPendingLoad();
    // Attach synchronously before observing identity; reports may precede load completion.
    const loading = replaceConnection
      ? this.#loadImmediately(normalized, signal)
      : Promise.resolve();
    const page = this.#active;
    await loading;
    signal.throwIfAborted();
    this.#assertActive(page);
    await this.#waitForIdentity(page, signal);
    // A successful early report is not a lease: recheck after every asynchronous wait.
    signal.throwIfAborted();
    this.#assertActive(page);
    if (page.url !== normalized) {
      throw new Error("Connection was replaced or closed.");
    }
    if (!page.hasActiveDocument || page.instanceId !== expectedInstanceId) {
      throw this.#identityMismatch(expectedInstanceId, page.instanceId);
    }
    const destination = resolveDeepLinkRoute(route, normalized);
    await waitForPage(
      page,
      replaceConnection
        ? page.view.webContents.loadURL(destination)
        : navigateInPage(page.view.webContents.mainFrame, destination),
      signal,
    );
    this.#assertActive(page);
  };

  #waitForIdentity = async (page: OwnedPage, requestSignal: AbortSignal) => {
    const signal = AbortSignal.any([page.controller.signal, requestSignal]);
    signal.throwIfAborted();
    if (page.instanceId !== undefined) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const dispose = () => {
        clearTimeout(timer);
        removeReportListener();
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        dispose();
        reject(signal.reason);
      };
      const removeReportListener = installInstanceReportIpc({
        getConfiguredUrl: () => page.url,
        getRemoteView: () =>
          this.#active === page && page.hasActiveDocument
            ? page.view
            : undefined,
        ipcMain,
        onReport: () => {
          dispose();
          resolve();
        },
      });
      const timer = setTimeout(() => {
        dispose();
        reject(
          new Error(
            "No authenticated instance was reported. Connect and sign in, then click the link again.",
          ),
        );
      }, identityDiscoveryTimeoutMs);
      signal.addEventListener("abort", abort, { once: true });
    });
  };

  close = () => {
    this.cancelPendingLoad();
    this.#removeActive();
    this.#options.onState();
  };

  clear = () => {
    this.#configuredUrl = undefined;
    this.#error = undefined;
    this.close();
  };

  // Window close keeps app-lifetime IPC installed; disposal is only for app teardown.
  dispose = () => {
    this.close();
    this.#disposeIpc?.();
    this.#disposeIpc = undefined;
  };

  layout = () => {
    const window = this.#options.getWindow();
    if (!window || !this.#active) {
      return;
    }
    const { height, width } = window.getContentBounds();
    this.#active.view.setBounds({ height, width, x: 0, y: 0 });
  };

  focus = () => {
    const webContents = this.#active?.view.webContents;
    if (
      this.#options.getWindow()?.isFocused() &&
      webContents &&
      !webContents.isDestroyed()
    ) {
      webContents.focus();
    }
  };

  reload = () => {
    this.#active?.view.webContents.reload();
  };
  openSettings = () => this.#navigateHostedPage(navigateToOvermuxSettings);
  openLogout = () => this.#navigateHostedPage(navigateToOvermuxLogout);
  openDeveloperTools = () => {
    const webContents = this.#active?.view.webContents;
    if (webContents && !webContents.isDestroyed()) {
      webContents.openDevTools({ mode: "detach" });
    }
  };

  #attach = (page: OwnedPage, display: PageDisplay) => {
    this.#removeActive();
    this.#configuredUrl = page.url;
    this.#active = page;
    this.#options.getWindow()?.contentView.addChildView(page.view);
    this.layout();
    this.focus();
    this.#error = undefined;
    const saved = this.#options.onSelected({ url: page.url, display });
    this.#options.onState();
    return saved;
  };

  #reportIdentity = (instanceId: string) => {
    const page = this.#active;
    if (!page?.hasActiveDocument) {
      return;
    }
    page.instanceId = instanceId;
    // Snapshot synchronously so a replacement or clear queues after this report.
    this.#options.onIdentity({ url: page.url, instanceId });
    this.#options.onState();
  };

  #createPage = (url: string): OwnedPage => {
    const configuredOrigin = getOrigin(url);
    const view = createRemoteView({
      configuredOrigin,
      onDeepLink: this.#options.onDeepLink,
      onExternal: (destination) => void this.#options.onExternal(destination),
      onLoadFailed: (description) => {
        if (this.#active?.view === view) {
          this.#error = `Overmux failed to load: ${description}`;
          this.#options.onState();
        }
      },
      onLoaded: () => {
        if (this.#active?.view === view) {
          this.#error = undefined;
          this.#options.onState();
        }
      },
      preload: join(import.meta.dirname, "remote-notifications.cjs"),
      remoteSession: this.#options.remoteSession,
    });
    const page: OwnedPage = {
      view,
      url,
      controller: new AbortController(),
      hasActiveDocument: false,
      disposeListeners: () => {
        view.webContents.removeListener("did-start-navigation", started);
        view.webContents.removeListener("did-frame-navigate", committed);
        view.webContents.removeListener("render-process-gone", reset);
        view.webContents.removeListener("destroyed", destroyed);
      },
    };
    const reset = () => {
      page.instanceId = undefined;
      page.hasActiveDocument = false;
      if (this.#active === page) {
        this.#options.onState();
      }
    };
    const started = (
      _event: Electron.Event,
      destination: string,
      isInPlace: boolean,
      isMainFrame: boolean,
    ) => {
      // Electron starts even intercepted overmux:/external navigation before will-navigate.
      // Those attempts leave the document intact and must not erase its identity.
      if (
        isMainFrame &&
        !isInPlace &&
        decideNavigation(destination, configuredOrigin).type === "allow"
      ) {
        reset();
      }
    };
    const committed = (
      _event: Electron.Event,
      _url: string,
      _code: number,
      _status: string,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame) {
        reset();
        // Navigation has committed. Preload reports may now precede load completion.
        // The browser has switched to the new document; resources may still be loading.
        page.hasActiveDocument = true;
      }
    };
    const destroyed = () => {
      reset();
      page.controller.abort();
    };
    view.webContents.on("did-start-navigation", started);
    view.webContents.on("did-frame-navigate", committed);
    view.webContents.on("render-process-gone", reset);
    view.webContents.on("destroyed", destroyed);
    return page;
  };

  #removeActive = () => {
    const page = this.#active;
    this.#active = undefined;
    if (!page) {
      return;
    }
    const window = this.#options.getWindow();
    if (window && !window.isDestroyed()) {
      window.contentView.removeChildView(page.view);
    }
    this.#disposePage(page);
  };

  #disposePage = (page: OwnedPage) => {
    page.controller.abort();
    page.disposeListeners();
    page.hasActiveDocument = false;
    page.instanceId = undefined;
    if (!page.view.webContents.isDestroyed()) {
      page.view.webContents.close();
    }
  };

  #assertActive: (page: OwnedPage | undefined) => asserts page is OwnedPage = (
    page,
  ) => {
    if (
      !page ||
      this.#active !== page ||
      page.view.webContents.isDestroyed() ||
      page.controller.signal.aborted
    ) {
      throw new Error("Connection was replaced or closed.");
    }
  };

  #identityMismatch = (expected: string, reported?: string) =>
    new Error(
      `Expected instance ${expected}, but this address reports ${reported ?? "no authenticated identity"}. The link was cancelled.`,
    );

  #navigateHostedPage = async (navigate: typeof navigateToOvermuxSettings) => {
    const page = this.#active;
    try {
      await navigate({
        configuredUrl: this.#configuredUrl,
        webContents: page?.view.webContents,
      });
    } catch (error) {
      if (this.#active === page) {
        this.#error = `Could not open Overmux page: ${formatError(error)}`;
        this.#options.onState();
      }
    }
  };
}
