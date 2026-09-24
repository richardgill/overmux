import {
  createOvermuxSettingsPath,
  overmuxLogoutPath,
  resolveOvermuxReturnTo,
} from "@overmux/shared";
import type { WebContents } from "electron";

type HostedWebContents = Pick<
  WebContents,
  "getURL" | "isDestroyed" | "loadURL"
>;

type HostedNavigationOptions = {
  configuredUrl?: string;
  webContents?: HostedWebContents;
};

const configuredOrigin = (configuredUrl?: string) => {
  try {
    return configuredUrl ? new URL(configuredUrl).origin : undefined;
  } catch {
    return undefined;
  }
};

const currentReturnTo = (webContents: HostedWebContents, origin: string) => {
  try {
    const current = new URL(webContents.getURL());
    if (current.origin !== origin) {
      return "/";
    }
    return resolveOvermuxReturnTo(
      `${current.pathname}${current.search}${current.hash}`,
    );
  } catch {
    return "/";
  }
};

const loadHostedPath = async (
  path: string,
  { configuredUrl, webContents }: HostedNavigationOptions,
) => {
  const origin = configuredOrigin(configuredUrl);
  if (!origin || !webContents || webContents.isDestroyed()) {
    return false;
  }
  await webContents.loadURL(new URL(path, origin).toString());
  return true;
};

export const navigateToOvermuxSettings = (options: HostedNavigationOptions) => {
  const origin = configuredOrigin(options.configuredUrl);
  const webContents = options.webContents;
  if (!origin || !webContents || webContents.isDestroyed()) {
    return Promise.resolve(false);
  }
  const returnTo = currentReturnTo(webContents, origin);
  return loadHostedPath(createOvermuxSettingsPath(returnTo), options);
};

export const navigateToOvermuxLogout = (options: HostedNavigationOptions) =>
  loadHostedPath(overmuxLogoutPath, options);
