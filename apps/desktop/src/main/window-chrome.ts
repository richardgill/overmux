import type { BrowserWindowConstructorOptions } from "electron";

import type { DesktopConfig } from "./desktop-config.js";

export type WindowChrome = {
  autoHideMenuBar: boolean;
  macosTrafficLightsVisible?: boolean;
  menuBarVisible?: boolean;
  titleBarStyle: BrowserWindowConstructorOptions["titleBarStyle"];
};

const titleBarStyle = (
  config: DesktopConfig,
  platform: NodeJS.Platform,
): WindowChrome["titleBarStyle"] => {
  if (platform === "darwin" && config.macosTitleBarStyle) {
    return config.macosTitleBarStyle === "native" ? "default" : "hidden";
  }
  return config.titleBar === "native" ? "default" : "hidden";
};

export const getWindowChrome = (
  config: DesktopConfig,
  platform: NodeJS.Platform = process.platform,
): WindowChrome => {
  const hasWindowMenu = platform !== "darwin";
  return {
    autoHideMenuBar: hasWindowMenu && config.menuBar === "auto-hide",
    ...(platform === "darwin"
      ? {
          macosTrafficLightsVisible: config.macosTrafficLights === "visible",
        }
      : {}),
    ...(hasWindowMenu && config.menuBar !== "auto-hide"
      ? { menuBarVisible: config.menuBar === "visible" }
      : {}),
    titleBarStyle: titleBarStyle(config, platform),
  };
};
