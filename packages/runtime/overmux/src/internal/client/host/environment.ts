import "./desktop-host";

type Platform = "macos" | "windows" | "linux" | "android" | "ios" | "unknown";
type BrowserNavigator = Navigator & {
  standalone?: boolean;
  userAgentData?: { platform: string };
};

const browserPlatform = (navigator: BrowserNavigator): Platform => {
  const { userAgent, maxTouchPoints } = navigator;
  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  const identity = `${platform} ${userAgent}`;
  // iPadOS can advertise itself as a Mac when requesting desktop websites.
  if (
    /iPad|iPhone|iPod/i.test(identity) ||
    (/Mac/i.test(identity) && maxTouchPoints > 1)
  ) {
    return "ios";
  }
  if (/Android/i.test(identity)) {
    return "android";
  }
  if (/Win/i.test(identity)) {
    return "windows";
  }
  if (/Mac/i.test(identity)) {
    return "macos";
  }
  return /Linux/i.test(identity) ? "linux" : "unknown";
};

const desktopPlatform = (platform: string): Platform => {
  if (platform === "darwin") {
    return "macos";
  }
  if (platform === "win32") {
    return "windows";
  }
  return platform === "linux" ? "linux" : "unknown";
};

export const installEnvironmentSelectors = () => {
  const html = document.documentElement;
  const host = window.overmuxHost;
  const desktop = host?.version === 1;
  const navigator: BrowserNavigator = window.navigator;
  html.dataset.omPlatform = desktop
    ? desktopPlatform(host.platform)
    : browserPlatform(navigator);
  if (desktop) {
    html.dataset.omHost = "desktop";
    return () => {};
  }

  // Fullscreen alone is not evidence of an installed app.
  const displayMode = window.matchMedia(
    "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)",
  );
  const updateHost = () => {
    html.dataset.omHost =
      displayMode.matches || navigator.standalone === true ? "pwa" : "browser";
  };
  updateHost();
  displayMode.addEventListener("change", updateHost);
  // The document owns these attributes; disposal only releases the live listener.
  return () => displayMode.removeEventListener("change", updateHost);
};
