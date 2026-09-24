// This hard-coded CLI seam delegates installation to the invoking project's integration.
// It intentionally resolves one known subpath rather than creating a plugin registry.
import { readFileSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildCommand } from "@stricli/core";

type ZellijInstallModule = {
  installZellij: (options: { session?: string }) => Promise<{
    artifactPath: string;
    pluginVersion: string;
    protocolVersion: number;
    session: string;
    sha256: string;
  }>;
};

type ZellijInstallDependencies = {
  cwd: string;
  importModule: (specifier: string) => Promise<ZellijInstallModule>;
  resolveInstall: () => string;
};

const resolveZellijInstall = (cwd: string) => {
  const projectUrl = pathToFileURL(resolve(cwd, "package.json"));
  const packagePath = findPackageJSON("@overmux/zellij/install", projectUrl);
  if (packagePath === undefined) {
    throw new Error("package not found");
  }
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
    exports?: { "./install"?: { import?: unknown } };
  };
  const installExport = packageJson.exports?.["./install"]?.import;
  if (typeof installExport !== "string") {
    throw new Error("package has no importable ./install export");
  }
  return resolve(dirname(packagePath), installExport);
};

const defaultDependencies = (): ZellijInstallDependencies => {
  const cwd = process.cwd();
  return {
    cwd,
    importModule: (specifier) =>
      import(specifier) as Promise<ZellijInstallModule>,
    resolveInstall: () => resolveZellijInstall(cwd),
  };
};

export const executeZellijInstall = async (
  { session }: { session?: string },
  dependencies = defaultDependencies(),
) => {
  let modulePath: string;
  try {
    modulePath = dependencies.resolveInstall();
  } catch {
    throw new Error(
      `Could not resolve @overmux/zellij/install from ${dependencies.cwd}. Add @overmux/zellij to this project, then run the command again.`,
    );
  }
  const integration = await dependencies.importModule(
    pathToFileURL(modulePath).href,
  );
  if (typeof integration.installZellij !== "function") {
    throw new Error(
      "@overmux/zellij/install does not export installZellij. Update @overmux/zellij and run the command again.",
    );
  }
  return integration.installZellij({ session });
};

const runZellijInstall = async ({ session }: { session?: string }) => {
  const result = await executeZellijInstall({ session });
  console.log(
    `Installed Zellij plugin ${result.pluginVersion} (protocol ${result.protocolVersion})\nSession: ${result.session}\nArtifact: ${result.artifactPath}\nSHA-256: ${result.sha256}`,
  );
};

export const zellijInstallCommand = buildCommand({
  docs: { brief: "Install and approve the @overmux/zellij plugin" },
  func: runZellijInstall,
  parameters: {
    flags: {
      session: {
        brief: "Target an active Zellij session",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "name",
      },
    },
  },
});
