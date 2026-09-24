import { describe, expect, it } from "vitest";

import { getOvermuxPaths } from "./paths";

describe("Overmux paths", () => {
  it("uses XDG default directories below the home directory", () => {
    expect(getOvermuxPaths({ environment: {}, homeDir: "/home/test" })).toEqual(
      {
        cacheDir: "/home/test/.cache/overmux",
        configDir: "/home/test/.config/overmux",
        dataDir: "/home/test/.local/share/overmux",
        stateDir: "/home/test/.local/state/overmux",
      },
    );
  });

  it("uses absolute configured XDG directories", () => {
    expect(
      getOvermuxPaths({
        environment: {
          XDG_CACHE_HOME: "/cache",
          XDG_CONFIG_HOME: "/config",
          XDG_DATA_HOME: "/data",
          XDG_RUNTIME_DIR: "/run/user/1000",
          XDG_STATE_HOME: "/state",
        },
        homeDir: "/home/test",
      }),
    ).toEqual({
      cacheDir: "/cache/overmux",
      configDir: "/config/overmux",
      dataDir: "/data/overmux",
      runtimeDir: "/run/user/1000/overmux",
      stateDir: "/state/overmux",
    });
  });

  it("ignores relative XDG directories and rejects a relative home", () => {
    expect(
      getOvermuxPaths({
        environment: {
          XDG_CACHE_HOME: "relative",
          XDG_CONFIG_HOME: "relative",
          XDG_DATA_HOME: "relative",
          XDG_RUNTIME_DIR: "relative",
          XDG_STATE_HOME: "relative",
        },
        homeDir: "/home/test",
      }),
    ).toEqual({
      cacheDir: "/home/test/.cache/overmux",
      configDir: "/home/test/.config/overmux",
      dataDir: "/home/test/.local/share/overmux",
      stateDir: "/home/test/.local/state/overmux",
    });
    expect(() => getOvermuxPaths({ homeDir: "relative" })).toThrow(
      "The home directory must be absolute.",
    );
  });
});
