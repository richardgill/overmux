import { configDefinitionRuntimeSchema } from "@overmux/shared/node";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveServerStartupOptions } from "./server-startup-options";

const createConfig = (startup?: object) =>
  configDefinitionRuntimeSchema.parse({
    auth: { mode: "cli-login" },
    ...startup,
    server: { resources: {} },
  });

describe("server startup options", () => {
  it("uses built-in defaults", () => {
    expect(
      resolveServerStartupOptions({
        config: createConfig(),
        configPath: "/tmp/overmux/config.ts",
      }),
    ).toStrictEqual({
      debug: true,
      host: "localhost",
      port: 4242,
      watch: true,
    });
  });

  it("preserves explicit debug configuration and overrides", () => {
    const config = createConfig({ debug: false });

    expect(
      resolveServerStartupOptions({
        config,
        configPath: "/tmp/overmux/config.ts",
      }).debug,
    ).toBe(false);
    expect(
      resolveServerStartupOptions({
        config,
        configPath: "/tmp/overmux/config.ts",
        overrides: { debug: true },
      }).debug,
    ).toBe(true);
    expect(
      resolveServerStartupOptions({
        config: createConfig({ debug: true }),
        configPath: "/tmp/overmux/config.ts",
        overrides: { debug: false },
      }).debug,
    ).toBe(false);
  });

  it("rejects port 0 in user configuration", () => {
    expect(() => createConfig({ port: 0 })).toThrow();
  });

  it("uses configuration values before built-in defaults", () => {
    expect(
      resolveServerStartupOptions({
        config: createConfig({ host: "0.0.0.0", port: 8080, watch: false }),
        configPath: "/tmp/overmux/config.ts",
      }),
    ).toMatchObject({ host: "0.0.0.0", port: 8080, watch: false });
  });

  it("allows port 0 only in private startup overrides", () => {
    expect(
      resolveServerStartupOptions({
        config: createConfig(),
        configPath: "/tmp/overmux/config.ts",
        overrides: { port: 0 },
      }).port,
    ).toBe(0);
  });

  it("uses explicit overrides before configuration values", () => {
    expect(
      resolveServerStartupOptions({
        config: createConfig({ host: "0.0.0.0", port: 8080, watch: false }),
        configPath: "/tmp/overmux/config.ts",
        overrides: { host: "localhost", port: 9000, watch: true },
      }),
    ).toMatchObject({ host: "localhost", port: 9000, watch: true });
  });

  it("preserves an explicit false watch override", () => {
    expect(
      resolveServerStartupOptions({
        config: createConfig({ watch: true }),
        configPath: "/tmp/overmux/config.ts",
        overrides: { watch: false },
      }).watch,
    ).toBe(false);
  });

  it("resolves configured production web assets relative to the config file", () => {
    expect(
      resolveServerStartupOptions({
        config: createConfig({ productionWebAssetsDir: "./web" }),
        configPath: "/tmp/overmux/config.ts",
      }).productionWebAssetsDir,
    ).toBe("/tmp/overmux/web");
  });

  it("resolves override paths from the current working directory", () => {
    expect(
      resolveServerStartupOptions({
        config: createConfig({ productionWebAssetsDir: "./configured-web" }),
        configPath: "/tmp/overmux/config.ts",
        overrides: { productionWebAssetsDir: "./cli-web" },
      }).productionWebAssetsDir,
    ).toBe(resolve("./cli-web"));
  });
});
