import { describe, expect, test as testCases } from "vitest";

import type { DesktopConfig } from "./desktop-config";
import { getWindowChrome } from "./window-chrome";

const defaults: DesktopConfig = {
  macosTrafficLights: "hidden",
  menuBar: "auto-hide",
  titleBar: "hidden",
};

describe("desktop window chrome", () => {
  testCases.each([
    {
      config: defaults,
      expected: {
        autoHideMenuBar: true,
        titleBarStyle: "hidden",
      },
      name: "preserves hidden Linux chrome defaults",
      platform: "linux",
    },
    {
      config: { ...defaults, menuBar: "visible", titleBar: "native" },
      expected: {
        autoHideMenuBar: false,
        menuBarVisible: true,
        titleBarStyle: "default",
      },
      name: "shows native Linux chrome",
      platform: "linux",
    },
    {
      config: { ...defaults, menuBar: "hidden" },
      expected: {
        autoHideMenuBar: false,
        menuBarVisible: false,
        titleBarStyle: "hidden",
      },
      name: "fully hides the Linux menu",
      platform: "linux",
    },
    {
      config: {
        ...defaults,
        macosTitleBarStyle: "transparent",
        macosTrafficLights: "visible",
        titleBar: "native",
      },
      expected: {
        autoHideMenuBar: false,
        macosTrafficLightsVisible: true,
        titleBarStyle: "hidden",
      },
      name: "applies transparent macOS chrome independently",
      platform: "darwin",
    },
    {
      config: {
        ...defaults,
        macosTitleBarStyle: "native",
      },
      expected: {
        autoHideMenuBar: false,
        macosTrafficLightsVisible: false,
        titleBarStyle: "default",
      },
      name: "uses the native macOS title bar without traffic lights",
      platform: "darwin",
    },
  ] as const)("$name", ({ config, expected, platform }) => {
    expect(
      getWindowChrome(config as DesktopConfig, platform as NodeJS.Platform),
    ).toEqual(expected);
  });
});
