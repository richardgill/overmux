import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
  type WindowOpenHandler = (details: { url: string }) => { action: "deny" };
  type NavigateHandler = (details: {
    isMainFrame: boolean;
    preventDefault: () => void;
    url: string;
  }) => void;

  const state: {
    options?: unknown;
    handlers: Map<string, (...arguments_: never[]) => void>;
    windowOpenHandler?: WindowOpenHandler;
  } = { handlers: new Map() };

  class MockWebContentsView {
    webContents = {
      on: (event: string, handler: (...arguments_: never[]) => void) => {
        state.handlers.set(event, handler);
      },
      setWindowOpenHandler: (handler: WindowOpenHandler) => {
        state.windowOpenHandler = handler;
      },
    };

    constructor(options: unknown) {
      state.options = options;
    }
  }

  const navigate = (
    event: "will-navigate" | "will-redirect",
    url: string,
    isMainFrame = true,
  ) => {
    const preventDefault = vi.fn();
    const handler = state.handlers.get(event) as NavigateHandler | undefined;
    handler?.({ isMainFrame, preventDefault, url });
    return preventDefault;
  };

  return { MockWebContentsView, navigate, state };
});

vi.mock("electron", () => ({
  WebContentsView: electronMocks.MockWebContentsView,
}));

import { createRemoteView } from "./remote-view.js";

const createTestView = () => {
  const onDeepLink = vi.fn();
  const onExternal = vi.fn();
  createRemoteView({
    configuredOrigin: "https://overmux.test",
    onDeepLink,
    onExternal,
    onLoadFailed: vi.fn(),
    onLoaded: vi.fn(),
    preload: "/app/remote-notifications.cjs",
    remoteSession: { id: "remote-session" } as never,
  });
  return { onDeepLink, onExternal };
};

beforeEach(() => {
  electronMocks.state.handlers.clear();
  electronMocks.state.options = undefined;
  electronMocks.state.windowOpenHandler = undefined;
});

describe("remote Overmux view", () => {
  it("creates a sandboxed view with the narrow notifications bridge", () => {
    createTestView();

    expect(electronMocks.state.options).toEqual({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: "/app/remote-notifications.cjs",
        sandbox: true,
        session: { id: "remote-session" },
        webSecurity: true,
      },
    });
  });

  it("denies child windows and routes only safe navigation", () => {
    const { onDeepLink, onExternal } = createTestView();

    expect(
      electronMocks.state.windowOpenHandler?.({
        url: "javascript:alert('unsafe')",
      }),
    ).toEqual({ action: "deny" });
    expect(onExternal).not.toHaveBeenCalled();

    electronMocks.state.windowOpenHandler?.({
      url: "file:///tmp/pi-session.md",
    });
    expect(onExternal).toHaveBeenCalledWith("file:///tmp/pi-session.md");

    const sameOriginPrevented = electronMocks.navigate(
      "will-navigate",
      "https://overmux.test/workspace",
    );
    expect(sameOriginPrevented).not.toHaveBeenCalled();

    const externalPrevented = electronMocks.navigate(
      "will-navigate",
      "https://docs.test/",
    );
    expect(externalPrevented).toHaveBeenCalledOnce();
    expect(onExternal).toHaveBeenCalledWith("https://docs.test/");

    electronMocks.navigate("will-navigate", "overmux://overmux.test/workspace");
    expect(onDeepLink).toHaveBeenCalledOnce();
  });

  it("routes window.open deep links inside the host without opening a child or OS handler", () => {
    const { onDeepLink, onExternal } = createTestView();
    const url = "overmux://rich-work-4242/tmux/$71/@647/%25647";

    expect(electronMocks.state.windowOpenHandler?.({ url })).toEqual({
      action: "deny",
    });
    expect(onDeepLink).toHaveBeenCalledWith(url);
    expect(onExternal).not.toHaveBeenCalled();

    electronMocks.state.windowOpenHandler?.({
      url: "overmux://user:password@evil.test/",
    });
    expect(onDeepLink).toHaveBeenCalledOnce();
  });

  it("applies the top-level navigation policy to redirects", () => {
    const { onDeepLink, onExternal } = createTestView();

    const sameOrigin = electronMocks.navigate(
      "will-redirect",
      "https://overmux.test/login/complete",
    );
    expect(sameOrigin).not.toHaveBeenCalled();

    const crossOrigin = electronMocks.navigate(
      "will-redirect",
      "https://identity.test/complete",
    );
    expect(crossOrigin).toHaveBeenCalledOnce();
    expect(onExternal).toHaveBeenCalledWith("https://identity.test/complete");

    const unsafe = electronMocks.navigate(
      "will-redirect",
      "file:///tmp/untrusted.html",
    );
    expect(unsafe).toHaveBeenCalledOnce();

    const deepLink = "overmux://overmux.test/workspace";
    const deepLinkRedirect = electronMocks.navigate("will-redirect", deepLink);
    expect(deepLinkRedirect).toHaveBeenCalledOnce();
    expect(onDeepLink).toHaveBeenCalledWith(deepLink);

    const subframe = electronMocks.navigate(
      "will-redirect",
      "https://embedded.test/",
      false,
    );
    expect(subframe).not.toHaveBeenCalled();
    expect(onExternal).not.toHaveBeenCalledWith("https://embedded.test/");
  });
});
