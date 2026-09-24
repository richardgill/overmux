import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as vite from "vite";
import { describe, expect, it, test as testCases, vi } from "vitest";

import { startManagedVite, validateViteServerConfig } from "./managed-vite";

const createHeartbeatFixture = async () => {
  const temporaryRoot = join(process.cwd(), ".test-tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "hmr-heartbeat-"));
  const configPath = join(directory, "vite.config.mjs");
  await writeFile(
    configPath,
    `export default {
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true, entries: [] },
      plugins: [{
        name: "user-plugin",
        configureServer(server) {
          server.middlewares.use("/user-plugin", (_request, response) => {
            response.end("user plugin still works");
          });
        },
      }],
    };`,
  );
  return { configPath, directory };
};

it("keeps user plugins and sends one heartbeat every 20s across Vite restarts", async () => {
  const { configPath, directory } = await createHeartbeatFixture();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
  let managed: Awaited<ReturnType<typeof startManagedVite>> | undefined;
  try {
    managed = await startManagedVite({ api: vite, configPath });
    const response = await fetch(`${managed.target}/user-plugin`);
    expect(await response.text()).toBe("user plugin still works");
    const send = vi.spyOn(managed.server.ws, "send");
    const heartbeat = setIntervalSpy.mock.results[0]!.value;
    expect(setIntervalSpy).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      20_000,
    );
    expect(heartbeat.hasRef()).toBe(false);
    vi.advanceTimersByTime(19_999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledExactlyOnceWith("overmux:heartbeat", {});
    vi.advanceTimersByTime(40_000);
    expect(send).toHaveBeenCalledTimes(3);

    await managed.server.restart();
    expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeat);
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    const restartedHeartbeat = setIntervalSpy.mock.results[1]!.value;
    expect(restartedHeartbeat.hasRef()).toBe(false);
    const restartedSend = vi.spyOn(managed.server.ws, "send");
    vi.advanceTimersByTime(20_000);
    expect(restartedSend).toHaveBeenCalledExactlyOnceWith(
      "overmux:heartbeat",
      {},
    );
    expect(send).toHaveBeenCalledTimes(3);

    await managed.close();
    expect(clearIntervalSpy).toHaveBeenCalledWith(restartedHeartbeat);
    vi.advanceTimersByTime(60_000);
    expect(restartedSend).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await managed?.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  }
});

describe("managed Vite configuration", () => {
  const managedSettingCases = [
    { config: { server: { host: "localhost" } }, setting: "server.host" },
    { config: { server: { port: 5173 } }, setting: "server.port" },
    { config: { server: { strictPort: true } }, setting: "server.strictPort" },
    { config: { server: { https: {} } }, setting: "server.https" },
    {
      config: { server: { hmr: { clientPort: 5173 } } },
      setting: "server.hmr.clientPort",
    },
    {
      config: { server: { hmr: { path: "/custom" } } },
      setting: "server.hmr.path",
    },
  ] as const;

  testCases.each(managedSettingCases)(
    "rejects managed $setting",
    ({ config, setting }) => {
      expect(() => validateViteServerConfig(config)).toThrow(setting);
    },
  );

  it("preserves non-listener Vite and HMR settings", () => {
    expect(() =>
      validateViteServerConfig({
        plugins: [],
        resolve: { alias: { application: "/src/application" } },
        server: { hmr: { overlay: false, timeout: 1_000 } },
      }),
    ).not.toThrow();
  });

  it("rejects disabled HMR", () => {
    expect(() => validateViteServerConfig({ server: { hmr: false } })).toThrow(
      "cannot be disabled",
    );
  });
});
