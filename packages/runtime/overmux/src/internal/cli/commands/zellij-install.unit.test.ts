import { describe, expect, it, vi } from "vitest";

import { executeZellijInstall } from "./zellij-install";

describe("overmux integration install zellij", () => {
  it("resolves and invokes the integration from the invoking project", async () => {
    const installZellij = vi.fn(async () => ({
      artifactPath: "/data/overmux.wasm",
      pluginVersion: "0.0.1",
      protocolVersion: 1,
      session: "work",
      sha256: "abc",
    }));
    const importModule = vi.fn(async () => ({ installZellij }));

    const result = await executeZellijInstall(
      { session: "work" },
      {
        cwd: "/project",
        importModule,
        resolveInstall: () =>
          "/project/node_modules/@overmux/zellij/dist/install/index.js",
      },
    );

    expect(importModule).toHaveBeenCalledWith(
      "file:///project/node_modules/@overmux/zellij/dist/install/index.js",
    );
    expect(installZellij).toHaveBeenCalledWith({ session: "work" });
    expect(result.session).toBe("work");
  });

  it("gives an actionable error when the integration is absent", async () => {
    await expect(
      executeZellijInstall(
        {},
        {
          cwd: "/project",
          importModule: vi.fn(),
          resolveInstall: () => {
            throw new Error("missing");
          },
        },
      ),
    ).rejects.toThrow("Add @overmux/zellij to this project");
  });
});
