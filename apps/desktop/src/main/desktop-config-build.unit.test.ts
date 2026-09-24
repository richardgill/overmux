import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type * as DesktopConfigModule from "./desktop-config";

const temporaryDirectories: string[] = [];
const require = createRequire(import.meta.url);

const createPackagedAppFixture = async () => {
  const temporaryRoot = resolve("../..", ".test-tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const appRoot = await mkdtemp(join(temporaryRoot, "desktop-package-"));
  temporaryDirectories.push(appRoot);

  await cp(resolve("dist"), join(appRoot, "dist"), { recursive: true });
  await mkdir(join(appRoot, "node_modules"));
  await cp(
    dirname(require.resolve("jiti/package.json")),
    join(appRoot, "node_modules/jiti"),
    { recursive: true },
  );
  await writeFile(join(appRoot, "package.json"), '{"type":"module"}\n');
  return appRoot;
};

describe("production desktop configuration", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    );
    temporaryDirectories.length = 0;
  });

  it("loads a real TypeScript config from the packaged dependency layout", async () => {
    const manifest = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies).toHaveProperty("jiti");

    const appRoot = await createPackagedAppFixture();
    const configPath = join(appRoot, "overmux.desktop.ts");
    await writeFile(
      configPath,
      `import { defineOvermuxDesktopConfig } from "@overmux/desktop";
export default defineOvermuxDesktopConfig({
  menuBar: "visible",
  titleBar: "native",
});
`,
    );

    const compiledModulePath = pathToFileURL(
      join(appRoot, "dist/main/desktop-config.js"),
    ).href;
    const { loadDesktopConfig } = (await import(
      compiledModulePath
    )) as typeof DesktopConfigModule;

    await expect(loadDesktopConfig({ configPath })).resolves.toEqual({
      macosTrafficLights: "hidden",
      menuBar: "visible",
      titleBar: "native",
    });
  });
});
