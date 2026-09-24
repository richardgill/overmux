import { afterEach, beforeEach, expect, it as testCases, vi } from "vitest";

import { installEnvironmentSelectors } from "./environment";

const displayMode = new EventTarget();
const disposeCallbacks: (() => void)[] = [];
let matches = false;

beforeEach(() => {
  matches = false;
  Object.defineProperty(displayMode, "matches", {
    configurable: true,
    get: () => matches,
  });
  vi.spyOn(window, "matchMedia").mockImplementation(
    (media) => Object.assign(displayMode, { media }) as MediaQueryList,
  );
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("");
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue("");
  vi.spyOn(window.navigator, "maxTouchPoints", "get").mockReturnValue(0);
});

afterEach(() => {
  disposeCallbacks.splice(0).forEach((dispose) => dispose());
  window.overmuxHost = undefined;
  document.documentElement.removeAttribute("data-om-host");
  document.documentElement.removeAttribute("data-om-platform");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const install = () => {
  const dispose = installEnvironmentSelectors();
  disposeCallbacks.push(dispose);
  return dispose;
};

const setDisplayMode = (value: boolean) => {
  matches = value;
  displayMode.dispatchEvent(new Event("change"));
};

testCases.each([
  {
    name: "Windows browser",
    platform: "Win32",
    userAgent: "Windows NT 10.0",
    expected: "windows",
  },
  {
    name: "Mac browser",
    platform: "MacIntel",
    userAgent: "Macintosh; Intel Mac OS X",
    expected: "macos",
  },
  {
    name: "Linux browser",
    platform: "Linux x86_64",
    userAgent: "X11; Linux x86_64",
    expected: "linux",
  },
  {
    name: "Android before Linux",
    platform: "Linux armv8l",
    userAgent: "Linux; Android 14",
    expected: "android",
  },
  {
    name: "iPhone",
    platform: "iPhone",
    userAgent: "iPhone; CPU iPhone OS 17_0 like Mac OS X",
    expected: "ios",
  },
  {
    name: "iPad desktop identity",
    platform: "MacIntel",
    userAgent: "Macintosh; Intel Mac OS X",
    touchPoints: 5,
    expected: "ios",
  },
  { name: "unknown browser", platform: "", userAgent: "", expected: "unknown" },
])(
  "sets independent html selectors for $name",
  ({ platform, userAgent, touchPoints, expected }) => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
    vi.spyOn(window.navigator, "maxTouchPoints", "get").mockReturnValue(
      touchPoints ?? 0,
    );

    install();

    expect(document.documentElement.getAttribute("data-om-host")).toBe(
      "browser",
    );
    expect(document.documentElement.getAttribute("data-om-platform")).toBe(
      expected,
    );
  },
);

testCases.each([
  ["darwin", "macos"],
  ["win32", "windows"],
  ["linux", "linux"],
  ["freebsd", "unknown"],
])(
  "uses authoritative desktop %s metadata ahead of browser and PWA detection",
  (platform, expected) => {
    window.overmuxHost = { version: 1, platform };
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("iPhone");
    matches = true;

    install();

    expect(document.documentElement.getAttribute("data-om-host")).toBe(
      "desktop",
    );
    expect(document.documentElement.getAttribute("data-om-platform")).toBe(
      expected,
    );
    expect(window.matchMedia).not.toHaveBeenCalled();
  },
);

testCases(
  "tracks installed display modes and stops observing on disposal",
  () => {
    matches = true;
    const removeListener = vi.spyOn(displayMode, "removeEventListener");
    const dispose = install();
    expect(document.documentElement.getAttribute("data-om-host")).toBe("pwa");
    expect(window.matchMedia).toHaveBeenCalledWith(
      "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)",
    );

    setDisplayMode(false);
    expect(document.documentElement.getAttribute("data-om-host")).toBe(
      "browser",
    );
    setDisplayMode(true);
    expect(document.documentElement.getAttribute("data-om-host")).toBe("pwa");

    dispose();
    expect(removeListener).toHaveBeenCalledWith("change", expect.any(Function));
    setDisplayMode(false);
    expect(document.documentElement.getAttribute("data-om-host")).toBe("pwa");
  },
);

testCases(
  "recognizes Safari installed mode without a matching display query",
  () => {
    vi.stubGlobal("navigator", {
      standalone: true,
      userAgent: "iPhone",
      platform: "iPhone",
      maxTouchPoints: 5,
    });

    install();

    expect(document.documentElement.getAttribute("data-om-host")).toBe("pwa");
    expect(document.documentElement.getAttribute("data-om-platform")).toBe(
      "ios",
    );
  },
);
