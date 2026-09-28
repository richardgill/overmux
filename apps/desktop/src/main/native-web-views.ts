import {
  keyBindingSequence,
  matchesShortcutBindingPrefix,
  normalizedShortcutBinding,
  type KeyBinding,
} from "@overmux/keybindings";
import {
  session,
  shell,
  WebContentsView,
  type BrowserWindow,
  type IpcMain,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from "electron";

import { nativeWebViewChannels } from "../shared/native-web-view-channels.js";
import {
  nativeWebViewBoundsSchema,
  nativeWebViewCommandSchema,
  type NativeWebViewBounds,
  type NativeWebViewCommand,
  type NativeWebViewError,
  type NativeWebViewPassthroughBinding,
} from "../shared/native-web-view.js";
import {
  isNativeWebUrlAllowed,
  nativeWebViewBounds,
  parseAllowedHttpOrigins,
} from "./native-web-view-policy.js";
import { isActiveRemoteMainFrame } from "./remote-notification-policy.js";

type Options = {
  getConfiguredUrl: () => string | undefined;
  getRemoteView: () => WebContentsView | undefined;
  getWindow: () => BrowserWindow | undefined;
};
type PassthroughState = {
  pending: KeyBinding[];
  pendingInputs: Electron.Input[];
  forwardingKeys: Set<string>;
  replaying: boolean;
  suppressedKeys: Set<string>;
  timeout: ReturnType<typeof setTimeout> | undefined;
};
type OwnedView = {
  id: string;
  view: WebContentsView;
  contents: WebContents;
  owner: WebContentsView;
  window: BrowserWindow;
  url: string;
  origins: Set<string>;
  passthroughBindings: NativeWebViewPassthroughBinding[];
  passthrough: PassthroughState;
  bounds: NativeWebViewBounds;
};

const inputKey = (input: Electron.Input) => input.code || input.key;

const keyBindingInput = (input: Electron.Input) => ({
  altKey: input.alt,
  ctrlKey: input.control,
  key: input.key,
  metaKey: input.meta,
  shiftKey: input.shift,
});

const replayKeyCode = (key: string) =>
  key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key;

const inputEvent = (
  input: Electron.Input,
  type = input.type,
): Electron.KeyboardInputEvent => ({
  keyCode: replayKeyCode(input.key),
  modifiers: input.modifiers as Electron.KeyboardInputEvent["modifiers"],
  type: type as Electron.KeyboardInputEvent["type"],
});

let nativeSession: Session | undefined;
const getNativeSession = () => {
  if (!nativeSession) {
    // All instances use this one persistent partition, never the Overmux session.
    nativeSession = session.fromPartition("persist:overmux-native-web");
    nativeSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    nativeSession.setPermissionCheckHandler(() => false);
    nativeSession.setDevicePermissionHandler(() => false);
    nativeSession.on("will-download", (event) => event.preventDefault());
  }
  return nativeSession;
};

export class NativeWebViews {
  readonly #options: Options;
  readonly #views = new Map<string, OwnedView>();

  constructor(options: Options) {
    this.#options = options;
  }

  registerIpc = (ipcMain: IpcMain) => {
    // Handlers do not await navigation. Creation, ownership and disposal are atomic;
    // a late loadURL completion can never attach or resurrect a native surface.
    ipcMain.handle(nativeWebViewChannels.command, this.#command);
    ipcMain.on(nativeWebViewChannels.bounds, this.#bounds);
    return () => {
      this.clear();
      ipcMain.removeHandler(nativeWebViewChannels.command);
      ipcMain.removeListener(nativeWebViewChannels.bounds, this.#bounds);
    };
  };

  #isOwner = (event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">) =>
    isActiveRemoteMainFrame(
      event,
      this.#options.getRemoteView(),
      this.#options.getConfiguredUrl(),
    );

  #command = (event: IpcMainInvokeEvent, input: unknown) => {
    if (!this.#isOwner(event)) {
      throw new Error(
        "Rejected native web view IPC from an untrusted renderer.",
      );
    }
    const command = nativeWebViewCommandSchema.parse(input);
    const existing = this.#views.get(command.id);
    if (existing && existing.owner !== this.#options.getRemoteView()) {
      throw new Error("Native web view belongs to another document.");
    }
    if (command.type === "destroy") {
      this.#destroy(command.id);
      return;
    }
    if (command.type === "create") {
      if (existing) {
        throw new Error("Native web view already exists.");
      }
      this.#create(command.id);
      return;
    }
    if (!existing) {
      throw new Error("Native web view no longer exists.");
    }
    this.#configure(existing, command);
  };

  #configure = (
    existing: OwnedView,
    command: Extract<NativeWebViewCommand, { type: "configure" }>,
  ) => {
    const origins = parseAllowedHttpOrigins(command.allowedHttpOrigins);
    this.#clearPassthrough(existing, true);
    existing.origins = origins;
    existing.passthroughBindings = command.passthroughBindings;
    if (!isNativeWebUrlAllowed(command.url, origins)) {
      // A revoked HTTP allowance must not leave the old document running. This
      // internal empty page is never an allowed destination for caller/page URLs.
      existing.url = "";
      void existing.contents.loadURL("about:blank").catch(() => undefined);
      this.#sendError(existing, {
        url: command.url,
        code: "ERR_URL_BLOCKED",
        message: "Native web view URL is not allowed.",
      });
      return;
    }
    const currentUrl = existing.contents.getURL();
    // Changing policy must not leave a now-forbidden in-page destination loaded.
    if (
      existing.url !== command.url ||
      (currentUrl && !isNativeWebUrlAllowed(currentUrl, origins))
    ) {
      existing.url = command.url;
      // did-fail-load owns main-frame errors. loadURL rejects for the same failure,
      // including superseded navigation, so consume it without duplicate reports.
      void existing.contents.loadURL(existing.url).catch(() => undefined);
    }
  };

  #create = (id: string) => {
    const owner = this.#options.getRemoteView();
    const window = this.#options.getWindow();
    if (!owner || !window || window.isDestroyed()) {
      throw new Error("Native web view host is unavailable.");
    }
    const view = new WebContentsView({
      webPreferences: {
        session: getNativeSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    // Electron may clear view.webContents after destruction; retain the contents
    // object so external destruction and explicit cleanup share an idempotent path.
    const contents = view.webContents;
    const entry: OwnedView = {
      id,
      view,
      contents,
      owner,
      window,
      url: "",
      origins: new Set(),
      passthroughBindings: [],
      passthrough: {
        pending: [],
        pendingInputs: [],
        forwardingKeys: new Set(),
        replaying: false,
        suppressedKeys: new Set(),
        timeout: undefined,
      },
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    };
    this.#views.set(id, entry);
    this.#guardNavigation(entry);
    this.#watchFailures(entry);
    this.#watchPassthroughShortcuts(entry);
    // Keep the initial surface hidden until the renderer has supplied real geometry.
    view.setVisible(false);
    window.contentView.addChildView(view);
  };

  #guardNavigation = (entry: OwnedView) => {
    const { contents } = entry;
    const guard = (
      event: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>,
    ) => {
      if (!isNativeWebUrlAllowed(event.url, entry.origins)) {
        event.preventDefault();
        if (event.isMainFrame) {
          this.#sendError(entry, {
            url: event.url,
            code: "ERR_URL_BLOCKED",
            message: "Native web view navigation is not allowed.",
          });
        }
      }
    };
    contents.on("will-frame-navigate", guard);
    contents.on("will-redirect", guard);
    contents.setWindowOpenHandler(({ url: destination }) => {
      if (isNativeWebUrlAllowed(destination, entry.origins)) {
        void shell.openExternal(destination).catch((cause: unknown) =>
          this.#sendError(entry, {
            url: destination,
            code: "ERR_OPEN_EXTERNAL",
            message: String(cause),
          }),
        );
      } else {
        this.#sendError(entry, {
          url: destination,
          code: "ERR_URL_BLOCKED",
          message: "Native web view popup URL is not allowed.",
        });
      }
      return { action: "deny" };
    });
  };

  #watchFailures = (entry: OwnedView) => {
    const { contents } = entry;
    contents.on(
      "did-fail-load",
      (_event, code, message, destination, isMainFrame) => {
        if (isMainFrame && code !== -3) {
          this.#sendError(entry, {
            url: destination,
            code: String(code),
            message,
          });
        }
      },
    );
    contents.on("render-process-gone", (_event, details) => {
      this.#sendError(entry, {
        url: contents.getURL() || entry.url,
        code: "ERR_RENDER_PROCESS_GONE",
        message: details.reason,
      });
      this.#destroy(entry.id);
    });
    contents.once("destroyed", () => this.#destroy(entry.id));
  };

  #watchPassthroughShortcuts = (entry: OwnedView) => {
    entry.contents.on("before-input-event", (event, input) =>
      this.#handlePassthroughInput(entry, event, input),
    );
  };

  #matchingPassthroughBindings = (entry: OwnedView, input: Electron.Input) =>
    entry.passthroughBindings.filter((binding) =>
      matchesShortcutBindingPrefix({
        binding,
        input: keyBindingInput(input),
        isMac: process.platform === "darwin",
        pending: entry.passthrough.pending,
      }),
    );

  #handlePassthroughInput = (
    entry: OwnedView,
    event: Electron.Event,
    input: Electron.Input,
  ) => {
    // Replayed Electron input can re-enter before-input-event and must reach the page.
    if (entry.passthrough.replaying) {
      return;
    }
    const key = inputKey(input);
    if (input.type === "keyUp") {
      if (!entry.passthrough.suppressedKeys.delete(key)) {
        return;
      }
      event.preventDefault();
      if (entry.passthrough.forwardingKeys.delete(key)) {
        this.#forwardPassthrough(entry, [input]);
      } else if (entry.passthrough.pending.length) {
        entry.passthrough.pendingInputs = [
          ...entry.passthrough.pendingInputs,
          input,
        ];
      }
      return;
    }
    if (input.type !== "keyDown") {
      return;
    }
    if (input.isAutoRepeat && entry.passthrough.suppressedKeys.has(key)) {
      event.preventDefault();
      return;
    }
    const matches = this.#matchingPassthroughBindings(entry, input);
    if (!matches.length) {
      if (entry.passthrough.pending.length) {
        event.preventDefault();
        entry.passthrough.suppressedKeys.add(key);
        this.#replayPassthrough(entry, [
          ...entry.passthrough.pendingInputs,
          input,
        ]);
        this.#clearPassthrough(entry, false);
      }
      return;
    }
    event.preventDefault();
    entry.passthrough.suppressedKeys.add(key);
    const complete = matches.find(
      (binding) =>
        keyBindingSequence(binding).length ===
        entry.passthrough.pending.length + 1,
    );
    if (complete) {
      // Forward once the sequence is complete so owner DOM shortcut handling sees it once.
      const inputs = [...entry.passthrough.pendingInputs, input];
      this.#clearPassthrough(entry, false);
      entry.passthrough.forwardingKeys.add(key);
      this.#forwardPassthrough(entry, inputs);
      return;
    }
    entry.passthrough.pending = [
      ...entry.passthrough.pending,
      normalizedShortcutBinding(matches[0]!, process.platform === "darwin")[
        entry.passthrough.pending.length
      ]!,
    ];
    entry.passthrough.pendingInputs = [
      ...entry.passthrough.pendingInputs,
      input,
    ];
    this.#schedulePassthroughTimeout(entry);
  };

  #schedulePassthroughTimeout = (entry: OwnedView) => {
    if (entry.passthrough.timeout !== undefined) {
      clearTimeout(entry.passthrough.timeout);
    }
    entry.passthrough.timeout = setTimeout(() => {
      this.#replayPassthrough(entry, entry.passthrough.pendingInputs);
      this.#clearPassthrough(entry, false);
    }, 1_000);
  };

  #replayPassthrough = (
    entry: OwnedView,
    inputs: readonly Electron.Input[],
  ) => {
    const released = new Set(
      inputs.filter((input) => input.type === "keyUp").map(inputKey),
    );
    entry.passthrough.replaying = true;
    try {
      inputs.forEach((input) =>
        entry.contents.sendInputEvent(inputEvent(input)),
      );
      inputs
        .filter(
          (input) => input.type === "keyDown" && !released.has(inputKey(input)),
        )
        .forEach((input) =>
          entry.contents.sendInputEvent(inputEvent(input, "keyUp")),
        );
    } finally {
      entry.passthrough.replaying = false;
    }
  };

  #clearPassthrough = (entry: OwnedView, replay: boolean) => {
    if (replay && entry.passthrough.pendingInputs.length) {
      this.#replayPassthrough(entry, entry.passthrough.pendingInputs);
    }
    entry.passthrough.pending = [];
    entry.passthrough.pendingInputs = [];
    if (entry.passthrough.timeout !== undefined) {
      clearTimeout(entry.passthrough.timeout);
      entry.passthrough.timeout = undefined;
    }
  };

  #forwardPassthrough = (
    entry: OwnedView,
    inputs: readonly Electron.Input[],
  ) => {
    if (
      this.#views.get(entry.id) === entry &&
      this.#options.getRemoteView() === entry.owner &&
      !entry.owner.webContents.isDestroyed()
    ) {
      inputs.forEach((input) =>
        entry.owner.webContents.sendInputEvent(inputEvent(input)),
      );
    }
  };

  #bounds = (event: Electron.IpcMainEvent, input: unknown) => {
    if (!this.#isOwner(event)) {
      return;
    }
    const parsed = nativeWebViewBoundsSchema.safeParse(input);
    if (!parsed.success) {
      return;
    }
    const entry = this.#views.get(parsed.data.id);
    if (entry && entry.owner === this.#options.getRemoteView()) {
      entry.bounds = parsed.data.bounds;
      this.#layout(entry);
    }
  };

  layout = () => this.#views.forEach(this.#layout);

  #layout = (entry: OwnedView) => {
    const bounds = nativeWebViewBounds(
      entry.bounds,
      entry.owner.getBounds(),
      entry.owner.webContents.getZoomFactor(),
    );
    entry.view.setBounds(bounds);
    entry.view.setVisible(bounds.width > 0 && bounds.height > 0);
  };

  #sendError = (entry: OwnedView, error: NativeWebViewError) => {
    if (
      this.#views.get(entry.id) !== entry ||
      this.#options.getRemoteView() !== entry.owner
    ) {
      return;
    }
    const contents = entry.owner.webContents;
    if (contents && !contents.isDestroyed()) {
      contents.send(nativeWebViewChannels.error, { id: entry.id, error });
    }
  };

  #destroy = (id: string) => {
    const entry = this.#views.get(id);
    if (!entry) {
      return;
    }
    this.#views.delete(id);
    this.#clearPassthrough(entry, false);
    if (!entry.window.isDestroyed()) {
      entry.window.contentView.removeChildView(entry.view);
    }
    if (!entry.contents.isDestroyed()) {
      // Do not let an untrusted beforeunload handler retain a surface or block teardown.
      entry.contents.close({ waitForBeforeUnload: false });
    }
  };

  clear = () => Array.from(this.#views.keys()).forEach(this.#destroy);
}
