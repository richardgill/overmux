import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, test as testCases } from "vitest";
import {
  beforePack,
  readDependencyNotices,
} from "./generate-dependency-notices.ts";

const desktopDirectory = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(desktopDirectory, "package.json"));
const reactDomRequire = createRequire(
  require.resolve("react-dom/package.json"),
);
const installedPackages = ["react", "react-dom", "scheduler", "zod"].map(
  (name) => {
    const manifestPath = (
      name === "scheduler" ? reactDomRequire : require
    ).resolve(`${name}/package.json`);
    const manifest = readFileSync(manifestPath, "utf8");
    const { version } = JSON.parse(manifest) as { version: string };
    const license = readFileSync(
      resolve(dirname(manifestPath), "LICENSE"),
      "utf8",
    );
    const path =
      name === "scheduler"
        ? "node_modules/react-dom/node_modules/scheduler"
        : `node_modules/${name}`;
    return { name, version, manifest, license, path };
  },
);
let appDir: string;

beforeEach(() => {
  const temporaryRoot = resolve(desktopDirectory, "../../.test-tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  appDir = mkdtempSync(resolve(temporaryRoot, "desktop-notices-"));
  writeFileSync(resolve(appDir, "package.json"), "{}");
  installedPackages.forEach(({ path, manifest, license }) => {
    const directory = resolve(appDir, path);
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, "package.json"), manifest);
    writeFileSync(resolve(directory, "LICENSE"), license);
  });
});

afterEach(() => rmSync(appDir, { recursive: true, force: true }));

it("regenerates packaging output with complete, unchanged installed license texts and versions", () => {
  mkdirSync(resolve(appDir, "dist"));
  const outputPath = resolve(appDir, "dist/THIRD_PARTY_NOTICES.md");
  writeFileSync(outputPath, "stale notices");
  // A hoisted Scheduler must not replace the copy React DOM actually resolves.
  const hoistedScheduler = resolve(appDir, "node_modules/scheduler");
  mkdirSync(hoistedScheduler);
  writeFileSync(
    resolve(hoistedScheduler, "package.json"),
    '{"version":"wrong"}',
  );
  writeFileSync(resolve(hoistedScheduler, "LICENSE"), "wrong license");

  beforePack({ packager: { info: { appDir } } });

  const expected =
    "# Bundled dependency notices\n\n" +
    installedPackages
      .map(
        ({ name, version, license }) => `## ${name}@${version}\n\n${license}`,
      )
      .join("\n\n") +
    "\n";
  expect(readFileSync(outputPath, "utf8")).toBe(expected);
  expect(readDependencyNotices(desktopDirectory)).toBe(expected);
});

testCases.each(installedPackages)(
  "fails packaging when $name's license is missing",
  ({ path }) => {
    rmSync(resolve(appDir, path, "LICENSE"));

    expect(() => beforePack({ packager: { info: { appDir } } })).toThrow(
      /ENOENT.*LICENSE/,
    );
  },
);

it("fails packaging rather than generating a notice with an empty license", () => {
  writeFileSync(resolve(appDir, "node_modules/zod/LICENSE"), " \n");

  expect(() => beforePack({ packager: { info: { appDir } } })).toThrow(
    "Missing license text",
  );
});
