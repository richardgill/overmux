import {
  beforeEach,
  describe,
  expect,
  it,
  test as testCases,
  vi,
} from "vitest";

import { guardTrustedShell } from "./trusted-shell.js";

type NavigationHandler = (details: {
  isMainFrame: boolean;
  preventDefault: () => void;
  url: string;
}) => void;

type WindowOpenHandler = () => { action: "deny" };

const handlers = new Map<string, NavigationHandler>();
let windowOpenHandler: WindowOpenHandler | undefined;

const webContents = {
  on: (event: string, handler: NavigationHandler) => {
    handlers.set(event, handler);
  },
  setWindowOpenHandler: (handler: WindowOpenHandler) => {
    windowOpenHandler = handler;
  },
};

const navigate = (
  event: "will-navigate" | "will-redirect",
  url: string,
  isMainFrame = true,
) => {
  const preventDefault = vi.fn();
  handlers.get(event)?.({ isMainFrame, preventDefault, url });
  return preventDefault;
};

beforeEach(() => {
  handlers.clear();
  windowOpenHandler = undefined;
});

describe("trusted shell navigation guard", () => {
  it("denies every child-window request", () => {
    guardTrustedShell(
      webContents as never,
      "file:///opt/overmux/renderer/index.html",
    );

    expect(windowOpenHandler?.()).toEqual({ action: "deny" });
  });

  testCases.each(["will-navigate", "will-redirect"] as const)(
    "keeps %s on the exact bundled document",
    (event) => {
      const documentUrl = "file:///opt/overmux/renderer/index.html";
      guardTrustedShell(webContents as never, documentUrl);

      expect(navigate(event, documentUrl)).not.toHaveBeenCalled();
      expect(navigate(event, "https://untrusted.test/")).toHaveBeenCalledOnce();
      expect(
        navigate(event, "file:///opt/overmux/renderer/other.html"),
      ).toHaveBeenCalledOnce();
    },
  );

  it("does not interfere with subframe redirects", () => {
    guardTrustedShell(
      webContents as never,
      "file:///opt/overmux/renderer/index.html",
    );

    expect(
      navigate("will-redirect", "https://embedded.test/", false),
    ).not.toHaveBeenCalled();
  });
});
