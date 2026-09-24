import { WebContentsView, type Session } from "electron";

import { decideNavigation } from "./url-policy.js";

type RemoteViewOptions = {
  configuredOrigin: string;
  onDeepLink: (url: string) => void;
  onExternal: (url: string) => void;
  onLoadFailed: (description: string) => void;
  onLoaded: () => void;
  preload: string;
  remoteSession: Session;
};

type NavigationDetails = {
  isMainFrame: boolean;
  preventDefault: () => void;
  url: string;
};

const handleNavigation = (
  details: NavigationDetails,
  options: Pick<
    RemoteViewOptions,
    "configuredOrigin" | "onDeepLink" | "onExternal"
  >,
) => {
  if (!details.isMainFrame) {
    return;
  }
  const decision = decideNavigation(details.url, options.configuredOrigin);
  if (decision.type === "allow") {
    return;
  }
  details.preventDefault();
  if (decision.type === "external") {
    options.onExternal(decision.url);
  }
  if (decision.type === "deep-link") {
    options.onDeepLink(decision.url);
  }
};

export const createRemoteView = ({
  configuredOrigin,
  onDeepLink,
  onExternal,
  onLoadFailed,
  onLoaded,
  preload,
  remoteSession,
}: RemoteViewOptions) => {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload,
      sandbox: true,
      session: remoteSession,
      webSecurity: true,
    },
  });
  view.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideNavigation(url, configuredOrigin);
    if (decision.type === "allow" || decision.type === "external") {
      onExternal(url);
    }
    if (decision.type === "deep-link") {
      onDeepLink(decision.url);
    }
    return { action: "deny" };
  });
  const navigationOptions = { configuredOrigin, onDeepLink, onExternal };
  view.webContents.on("will-navigate", (details) =>
    handleNavigation(details, navigationOptions),
  );
  view.webContents.on("will-redirect", (details) =>
    handleNavigation(details, navigationOptions),
  );
  view.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        onLoadFailed(errorDescription);
      }
    },
  );
  view.webContents.on("did-finish-load", onLoaded);
  return view;
};
