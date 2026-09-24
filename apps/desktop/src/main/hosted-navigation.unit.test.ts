import { describe, expect, it, vi } from "vitest";

import {
  navigateToOvermuxLogout,
  navigateToOvermuxSettings,
} from "./hosted-navigation.js";

const createWebContents = (currentUrl: string, destroyed = false) => ({
  getURL: vi.fn(() => currentUrl),
  isDestroyed: vi.fn(() => destroyed),
  loadURL: vi.fn(async () => undefined),
});

describe("desktop hosted navigation", () => {
  it("loads settings in the remote main frame with its current userland path", async () => {
    const webContents = createWebContents(
      "https://overmux.test/workspaces/one?tab=diff#file",
    );

    await expect(
      navigateToOvermuxSettings({
        configuredUrl: "https://overmux.test/initial",
        webContents: webContents as never,
      }),
    ).resolves.toBe(true);

    expect(webContents.loadURL).toHaveBeenCalledWith(
      "https://overmux.test/_overmux/settings?returnTo=%2Fworkspaces%2Fone%3Ftab%3Ddiff%23file",
    );
  });

  it("does not preserve foreign or hosted paths as return targets", async () => {
    const foreign = createWebContents("https://attacker.test/workspace");
    const hosted = createWebContents("https://overmux.test/_overmux/logout");

    await navigateToOvermuxSettings({
      configuredUrl: "https://overmux.test/",
      webContents: foreign as never,
    });
    await navigateToOvermuxSettings({
      configuredUrl: "https://overmux.test/",
      webContents: hosted as never,
    });

    expect(foreign.loadURL).toHaveBeenCalledWith(
      "https://overmux.test/_overmux/settings",
    );
    expect(hosted.loadURL).toHaveBeenCalledWith(
      "https://overmux.test/_overmux/settings",
    );
  });

  it("loads logout without replacing the configured instance", async () => {
    const webContents = createWebContents("https://overmux.test/workspace");

    await navigateToOvermuxLogout({
      configuredUrl: "https://overmux.test/original",
      webContents: webContents as never,
    });

    expect(webContents.loadURL).toHaveBeenCalledWith(
      "https://overmux.test/_overmux/logout",
    );
  });

  it("is safe without a configured live view", async () => {
    const destroyed = createWebContents("https://overmux.test/", true);

    await expect(navigateToOvermuxSettings({})).resolves.toBe(false);
    await expect(
      navigateToOvermuxLogout({
        configuredUrl: "https://overmux.test/",
        webContents: destroyed as never,
      }),
    ).resolves.toBe(false);
    expect(destroyed.loadURL).not.toHaveBeenCalled();
  });
});
