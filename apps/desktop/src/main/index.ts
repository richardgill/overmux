import { getOvermuxPaths } from "@overmux/shared/node";
import { app, BrowserWindow, dialog, session } from "electron";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { ConfigStore } from "./config-store.js";
import { getDesktopConfigPath, loadDesktopConfig } from "./desktop-config.js";
import { DesktopApp } from "./desktop-app.js";

let desktopApp: DesktopApp | undefined;
const pendingDeepLinks: string[] = [];

const findDeepLink = (arguments_: readonly string[]) =>
  arguments_.find((argument) =>
    argument.toLowerCase().startsWith("overmux://"),
  );

const routeOrQueueDeepLink = (url: string) => {
  if (desktopApp) {
    void desktopApp.routeDeepLink(url);
    return;
  }
  pendingDeepLinks.push(url);
};

const gpuDeviceDiagnostics = (gpuInfo: unknown) => {
  const devices = (gpuInfo as { gpuDevice?: unknown })?.gpuDevice;
  if (!Array.isArray(devices)) {
    return [];
  }
  return devices.map((value) => {
    const device = value as Record<string, unknown>;
    return {
      active: device.active,
      deviceId: device.deviceId,
      driverVendor: device.driverVendor,
      driverVersion: device.driverVersion,
      vendorId: device.vendorId,
    };
  });
};

const reportGpuDiagnostics = async () => {
  if (process.env.OVERMUX_ELECTRON_GPU_DIAGNOSTICS !== "1") {
    return;
  }
  const gpuInfo = await app.getGPUInfo("basic");
  console.info("[overmux/electron] GPU diagnostics", {
    featureStatus: app.getGPUFeatureStatus(),
    gpuDevices: gpuDeviceDiagnostics(gpuInfo),
  });
};

const formatStartupError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return "An unexpected error occurred.";
  }
  const cause =
    error.cause instanceof Error ? `\n\n${error.cause.message}` : "";
  return `${error.message}${cause}`;
};

const registerProtocolClient = () => {
  const developmentArguments =
    process.defaultApp && process.argv[1] ? [resolve(process.argv[1])] : [];
  app.setAsDefaultProtocolClient(
    "overmux",
    process.execPath,
    developmentArguments,
  );
};

const start = async () => {
  const config = await loadDesktopConfig({
    configPath: getDesktopConfigPath(),
  });
  const configStore = new ConfigStore(
    join(app.getPath("userData"), "desktop-config.json"),
  );
  const startingApp = new DesktopApp({
    config,
    configStore,
    remoteSession: session.fromPartition("persist:overmux-remote"),
    serverUrl: process.env.OVERMUX_SERVER_URL,
  });
  startingApp.configureRemoteSession();
  startingApp.registerIpc();
  startingApp.installMenu();
  const initialDeepLink = findDeepLink(process.argv);
  if (initialDeepLink) {
    pendingDeepLinks.push(initialDeepLink);
  }
  // Wait for the bundled desktop UI and saved addresses, not the server's web UI.
  // Incoming links can then be handled even if the previous server is still loading.
  await startingApp.open();
  desktopApp = startingApp;
  const links = pendingDeepLinks.splice(0);
  await Promise.all(links.map((url) => desktopApp?.routeDeepLink(url)));
};

const profileDirectory = join(getOvermuxPaths().stateDir, "desktop");
mkdirSync(profileDirectory, { recursive: true });
// Set both paths before Chromium initializes sessions or the profile-scoped lock.
app.setPath("userData", profileDirectory);
app.setPath("sessionData", profileDirectory);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    routeOrQueueDeepLink(url);
  });
  app.on("second-instance", (_event, commandLine) => {
    const deepLink = findDeepLink(commandLine);
    if (deepLink) {
      routeOrQueueDeepLink(deepLink);
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  app.on("activate", () => {
    const activeApp = desktopApp;
    if (activeApp && BrowserWindow.getAllWindows().length === 0) {
      void activeApp.open().catch((error: unknown) => {
        console.error(error);
        dialog.showErrorBox(
          "Overmux could not reopen",
          formatStartupError(error),
        );
      });
    }
  });
  registerProtocolClient();
  void app
    .whenReady()
    .then(async () => {
      await reportGpuDiagnostics();
      await start();
      if (process.env.OVERMUX_DESKTOP_SMOKE_TEST === "1") {
        console.info("OVERMUX_DESKTOP_SMOKE_OK");
        app.quit();
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      dialog.showErrorBox("Overmux could not start", formatStartupError(error));
      app.quit();
    });
}
