import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  test as testCases,
  vi,
} from "vitest";

import { getDesktopConfigPath, loadDesktopConfig } from "./desktop-config";

const temporaryDirectories: string[] = [];
const configApiPath = resolve("src/config/index.ts");

const createTemporaryDirectory = async () => {
  const root = resolve("../..", ".test-tmp");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "desktop-config-"));
  temporaryDirectories.push(directory);
  return directory;
};

describe("desktop configuration", () => {
  beforeEach(() => {
    temporaryDirectories.length = 0;
  });

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
  });

  it("resolves the XDG config path and an explicit override", () => {
    expect(
      getDesktopConfigPath({
        arguments_: [],
        paths: { homeDir: "/home/test", xdgConfigHome: "/config" },
      }),
    ).toBe("/config/overmux/overmux.desktop.ts");
    expect(
      getDesktopConfigPath({
        arguments_: ["--desktop-config", "./custom.desktop.ts"],
      }),
    ).toBe(resolve("./custom.desktop.ts"));
    expect(() =>
      getDesktopConfigPath({ arguments_: ["--desktop-config"] }),
    ).toThrow("--desktop-config requires a file path");
  });

  it("uses the current desktop defaults when the config is absent", async () => {
    const directory = await createTemporaryDirectory();

    await expect(
      loadDesktopConfig({ configPath: join(directory, "missing.ts") }),
    ).resolves.toEqual({
      macosTrafficLights: "hidden",
      menuBar: "auto-hide",
      titleBar: "hidden",
    });
  });

  it("loads a typed flat configuration through the desktop package", async () => {
    const directory = await createTemporaryDirectory();
    const configPath = join(directory, "overmux.desktop.ts");
    await writeFile(
      configPath,
      `import { defineOvermuxDesktopConfig } from "@overmux/desktop";
export default defineOvermuxDesktopConfig({
  macosTitleBarStyle: "transparent",
  macosTrafficLights: "visible",
  menuBar: "visible",
  titleBar: "native",
});
`,
    );

    await expect(
      loadDesktopConfig({ configApiPath, configPath }),
    ).resolves.toEqual({
      macosTitleBarStyle: "transparent",
      macosTrafficLights: "visible",
      menuBar: "visible",
      titleBar: "native",
    });
  });

  it("retains the loaded input callback without wrapping it", async () => {
    const directory = await createTemporaryDirectory();
    const configPath = join(directory, "overmux.desktop.ts");
    await writeFile(
      configPath,
      `import { defineOvermuxDesktopConfig } from "@overmux/desktop";
export default defineOvermuxDesktopConfig({
  onBeforeInputEvent: ({ event, webContents }) => {
    event.preventDefault();
    webContents.copy();
  },
});
`,
    );

    const config = await loadDesktopConfig({ configApiPath, configPath });
    const event = { preventDefault: vi.fn() };
    const webContents = { copy: vi.fn() };
    config.onBeforeInputEvent?.({ event, input: {}, webContents } as never);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(webContents.copy).toHaveBeenCalledOnce();
    const { desktopConfigRuntimeSchema } = await import("../config/schema.js");
    expect(desktopConfigRuntimeSchema.parse(config).onBeforeInputEvent).toBe(
      config.onBeforeInputEvent,
    );
  });

  const invalidHookCases = ["null", "false", "42", '"copy"', "{}"];
  testCases.each(invalidHookCases)(
    "rejects non-function input hook %s",
    async (value) => {
      const directory = await createTemporaryDirectory();
      const configPath = join(directory, "overmux.desktop.ts");
      await writeFile(
        configPath,
        `export default { onBeforeInputEvent: ${value} };\n`,
      );

      await expect(
        loadDesktopConfig({ configApiPath, configPath }),
      ).rejects.toThrow(`Could not load desktop config at ${configPath}`);
    },
  );

  it("rejects invalid or unknown desktop settings", async () => {
    const directory = await createTemporaryDirectory();
    const configPath = join(directory, "overmux.desktop.ts");
    await writeFile(
      configPath,
      'export default { menuBar: "sometimes", width: 1200 };\n',
    );

    await expect(
      loadDesktopConfig({ configApiPath, configPath }),
    ).rejects.toThrow(`Could not load desktop config at ${configPath}`);
  });
});
