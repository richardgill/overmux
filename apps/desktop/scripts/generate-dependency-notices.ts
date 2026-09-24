import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { Packager } from "electron-builder";

// These packages are bundled by vite.config.ts; Electron/Chromium and the
// external jiti dependency retain their own notices during packaging.
// Resolve Scheduler from React DOM, not a possibly different workspace copy.
const bundledPackages: { name: string; from?: string }[] = [
  { name: "react" },
  { name: "react-dom" },
  { name: "scheduler", from: "react-dom" },
  { name: "zod" },
];

export const readDependencyNotices = (appDirectory: string) => {
  const require = createRequire(resolve(appDirectory, "package.json"));
  const sections = bundledPackages.map(({ name, from }) => {
    const dependencyRequire = from
      ? createRequire(require.resolve(`${from}/package.json`))
      : require;
    const manifestPath = dependencyRequire.resolve(`${name}/package.json`);
    const { version } = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version: string;
    };
    const licensePath = resolve(dirname(manifestPath), "LICENSE");
    const license = readFileSync(licensePath, "utf8");
    if (!license.trim()) {
      throw new Error(`Missing license text in ${licensePath}`);
    }
    return `## ${name}@${version}\n\n${license}`;
  });
  return `# Bundled dependency notices\n\n${sections.join("\n\n")}\n`;
};

export const beforePack = ({
  packager,
}: {
  packager: { info: Pick<Packager, "appDir"> };
}) => {
  // Read every license before writing so missing upstream notices fail packaging.
  const notices = readDependencyNotices(packager.info.appDir);
  const outputPath = resolve(
    packager.info.appDir,
    "dist/THIRD_PARTY_NOTICES.md",
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, notices);
};
