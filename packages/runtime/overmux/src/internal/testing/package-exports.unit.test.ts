import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import * as client from "../../public/client";
import * as overmux from "../../public/index";
import * as server from "../../public/server";

const packageDirectory = resolve(import.meta.dirname, "../../..");
const legacyPackages = ["core", "client", "server"].map(
  (name) => `@overmux/${name}`,
);

const readPackageJson = async () =>
  JSON.parse(
    await readFile(resolve(packageDirectory, "package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
    exports: Record<string, unknown>;
    files: string[];
  };

const declarationFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? declarationFiles(path)
          : Promise.resolve(path.endsWith(".d.ts") ? [path] : []);
      }),
    )
  ).flat();
};

describe("overmux package exports", () => {
  it("publishes exactly the neutral, client, and server entry points", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.exports).toEqual({
      ".": {
        import: "./dist/exports/index.js",
        types: "./dist/exports/index.d.ts",
      },
      "./client": {
        import: "./dist/exports/client.js",
        types: "./dist/exports/client.d.ts",
      },
      "./server": {
        import: "./dist/exports/server.js",
        types: "./dist/exports/server.d.ts",
      },
    });
  });

  it("ships inspectable source without package test support", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "src",
        "!src/**/*.test.*",
        "!src/**/fixtures",
        "!src/**/testing",
      ]),
    );
  });

  it("keeps each supported public API on its intended entry point", () => {
    expect(overmux).toMatchObject({
      composeAiContext: expect.any(Function),
      coreAiContextSnippets: ["package-source"],
      createOvermuxSettingsPath: expect.any(Function),
      defaultAiContextSnippets: [
        "package-source",
        "tech-stack-recommendations",
      ],
      defineOperation: expect.any(Function),
      defineOvermuxConfig: expect.any(Function),
      defineResourceContract: expect.any(Function),
      notificationSchema: expect.any(Object),
      overmuxLogoutPath: "/_overmux/logout",
      overmuxSettingsPath: "/_overmux/settings",
      packageSourceSnippet: "package-source",
      resolveOvermuxReturnTo: expect.any(Function),
      techStackRecommendationsSnippet: "tech-stack-recommendations",
    });
    expect(client).toMatchObject({
      createOvermuxHooks: expect.any(Function),
      defineCommandRegistry: expect.any(Function),
      OvermuxPortal: expect.any(Function),
      OvermuxThemeScope: expect.any(Function),
    });
    expect(client).not.toHaveProperty("OvermuxProvider");
    expect(client).not.toHaveProperty("OvermuxProviderProps");
    expect(overmux).not.toHaveProperty("runtimeManifestSchema");
  });

  it("exposes server path resolution at runtime and in declarations", async () => {
    const declaration = await readFile(
      resolve(packageDirectory, "dist/exports/server.d.ts"),
      "utf8",
    );

    expect(server).toMatchObject({ getOvermuxPaths: expect.any(Function) });
    expect(declaration).toContain("getOvermuxPaths");
  });

  it("does not depend on ecosystem or former runtime packages", async () => {
    const packageJson = await readPackageJson();

    legacyPackages.forEach((packageName) => {
      expect(packageJson.dependencies).not.toHaveProperty(packageName);
    });
    ["ai-context", "git", "pi", "tmux", "ui"].forEach((name) => {
      expect(packageJson.dependencies).not.toHaveProperty(`@overmux/${name}`);
    });
  });

  it("emits declarations without former package or internal source paths", async () => {
    const files = await declarationFiles(resolve(packageDirectory, "dist"));
    const declarations = await Promise.all(
      files.map((file) => readFile(file, "utf8")),
    );
    const output = declarations.join("\n");

    expect(files.length).toBeGreaterThan(0);
    expect(output).not.toContain("@overmux/ai-context");
    legacyPackages.forEach((packageName) => {
      expect(output).not.toContain(packageName);
    });
    expect(output).not.toMatch(
      /(?:\.\.\/)+src\/internal|packages\/runtime\/overmux\/src\/internal/u,
    );
  });
});
