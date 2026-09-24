import { describe, expect, it } from "vitest";

import { getDefaultConfigPath, getOvermuxPaths } from "./paths";

describe("Overmux server paths", () => {
  it("resolves the default configuration file", () => {
    expect(
      getDefaultConfigPath({
        homeDir: "/home/test",
        xdgConfigHome: "/custom/config",
      }),
    ).toBe("/custom/config/overmux/overmux.config.ts");
    expect(
      getDefaultConfigPath({
        homeDir: "/home/test",
        xdgConfigHome: "relative/config",
      }),
    ).toBe("/home/test/.config/overmux/overmux.config.ts");
  });

  it("keeps the shared path resolver available through the server API", () => {
    expect(
      getOvermuxPaths({ homeDir: "/home/test", xdgConfigHome: "/config" })
        .configDir,
    ).toBe("/config/overmux");
  });
});
