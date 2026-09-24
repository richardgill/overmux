import { extractFile, listPackage } from "@electron/asar";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readDependencyNotices } from "./generate-dependency-notices.ts";
import {
  detectDesktopRelease,
  getDesktopChangelogEntry,
  prepareDesktopRelease,
  readDesktopReleaseState,
  resolveMainReleaseCommit,
  validateDesktopReleaseCommit,
} from "./desktop-release-plan.ts";

const require = createRequire(import.meta.url);
const { FuseV1Options, getCurrentFuseWire } =
  require("@electron/fuses") as typeof import("@electron/fuses");
const disabledFuseState = "0".charCodeAt(0);
const enabledFuseState = "1".charCodeAt(0);
const packageDirectory = resolve(import.meta.dirname, "..");
const workspaceDirectory = resolve(packageDirectory, "../..");
const releaseDirectory = resolve(packageDirectory, "release");
const temporaryDirectory = resolve(
  workspaceDirectory,
  ".test-tmp/desktop-release",
);
const packageMetadata = JSON.parse(
  readFileSync(resolve(packageDirectory, "package.json"), "utf8"),
) as { version: string };

type DesktopTarget = "linux-x64" | "mac-arm64" | "mac-x64";
type MacArchitecture = "arm64" | "x64";

export const getLinuxDesktopArtifactNames = (version: string) => [
  `Overmux-Desktop-${version}-linux-x64.AppImage`,
  `overmux-desktop_${version}_amd64.deb`,
];

export const getMacDesktopArtifactName = (
  version: string,
  architecture: MacArchitecture,
) => `Overmux-Desktop-${version}-mac-${architecture}.zip`;

export const getDesktopArtifactNames = (version: string) => [
  ...getLinuxDesktopArtifactNames(version),
  getMacDesktopArtifactName(version, "arm64"),
  getMacDesktopArtifactName(version, "x64"),
];

export const validateDesktopReleaseTag = (tag: string, version: string) => {
  const expected = `desktop-v${version}`;
  if (tag !== expected) {
    throw new Error(`Desktop release tag must be ${expected}, received ${tag}`);
  }
};

const findFile = (directory: string, name: string): string | undefined => {
  const entries = readdirSync(directory, { withFileTypes: true });
  const match = entries.find((entry) => entry.isFile() && entry.name === name);
  if (match) {
    return resolve(directory, match.name);
  }
  const directories = entries.filter((entry) => entry.isDirectory());
  return directories
    .map((entry) => findFile(resolve(directory, entry.name), name))
    .find(Boolean);
};

const assertEqual = (actual: unknown, expected: unknown, context: string) => {
  if (actual !== expected) {
    throw new Error(
      `${context}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
};

const assertNonEmpty = (path: string) => {
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`Missing or empty desktop release artifact ${path}`);
  }
};

const assertAppArchive = (archivePath: string) => {
  const entries = listPackage(archivePath, { isPack: false });
  const required = [
    "/dist/THIRD_PARTY_NOTICES.md",
    "/dist/config/index.js",
    "/dist/main/index.js",
    "/dist/main/preload.cjs",
    "/dist/renderer/index.html",
    "/node_modules/jiti/lib/jiti.mjs",
    "/node_modules/jiti/LICENSE",
    "/package.json",
    "/LICENSE",
  ];
  required.forEach((entry) => {
    if (!entries.includes(entry)) {
      throw new Error(`${basename(archivePath)} is missing ${entry}`);
    }
  });

  assertEqual(
    extractFile(archivePath, "dist/THIRD_PARTY_NOTICES.md").toString("utf8"),
    readDependencyNotices(packageDirectory),
    "Bundled dependency notices must preserve the installed upstream licenses",
  );

  const forbidden = entries.find(
    (entry) =>
      entry.startsWith("/src/") ||
      entry.includes(".test.") ||
      entry.endsWith(".ts") ||
      entry.includes("overmux-runtime") ||
      entry.includes("node_modules/overmux/"),
  );
  if (forbidden) {
    throw new Error(
      `${basename(archivePath)} contains forbidden entry ${forbidden}`,
    );
  }
};

const assertFuses = async (executablePath: string) => {
  const fuses = await getCurrentFuseWire(executablePath);
  const expected = new Map([
    [FuseV1Options.RunAsNode, disabledFuseState],
    [FuseV1Options.EnableCookieEncryption, enabledFuseState],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, disabledFuseState],
    [FuseV1Options.EnableNodeCliInspectArguments, disabledFuseState],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, enabledFuseState],
    [FuseV1Options.OnlyLoadAppFromAsar, enabledFuseState],
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, disabledFuseState],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, enabledFuseState],
    [FuseV1Options.WasmTrapHandlers, enabledFuseState],
  ]);
  expected.forEach((state, fuse) => {
    assertEqual(fuses[fuse], state, `Electron fuse ${FuseV1Options[fuse]}`);
  });
};

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const getRequiredFile = (directory: string, name: string) => {
  const path = findFile(directory, name);
  if (!path) {
    throw new Error(`${directory} is missing ${name}`);
  }
  return path;
};

const getLinuxReleaseArtifacts = () => {
  const [appImageName, debName] = getLinuxDesktopArtifactNames(
    packageMetadata.version,
  );
  const names = readdirSync(releaseDirectory)
    .filter((name) => name.endsWith(".AppImage") || name.endsWith(".deb"))
    .sort();
  assertEqual(
    JSON.stringify(names),
    JSON.stringify([appImageName, debName].sort()),
    "Desktop Linux release artifacts",
  );
  if (existsSync(resolve(releaseDirectory, "latest-linux.yml"))) {
    throw new Error("Desktop package must not generate auto-update metadata");
  }

  const appImagePath = resolve(releaseDirectory, appImageName);
  const debPath = resolve(releaseDirectory, debName);
  [appImagePath, debPath].forEach(assertNonEmpty);
  return { appImagePath, debPath };
};

const assertDebMetadata = (debPath: string) => {
  const fields = [
    ["Package", "overmux-desktop"],
    ["Version", packageMetadata.version],
    ["Architecture", "amd64"],
    ["License", "MIT"],
    ["Section", "devel"],
    ["Maintainer", "Richard Gill <richard@rgill.co.uk>"],
  ] as const;
  fields.forEach(([field, expected]) => {
    const actual = execFileSync("dpkg-deb", ["--field", debPath, field], {
      encoding: "utf8",
    }).trim();
    assertEqual(actual, expected, `Debian package ${field.toLowerCase()}`);
  });
};

const extractLinuxPackages = ({
  appImagePath,
  debPath,
}: {
  appImagePath: string;
  debPath: string;
}) => {
  rmSync(temporaryDirectory, { force: true, recursive: true });
  mkdirSync(temporaryDirectory, { recursive: true });
  const appImageDirectory = resolve(temporaryDirectory, "appimage");
  const debDirectory = resolve(temporaryDirectory, "deb");
  mkdirSync(appImageDirectory);
  mkdirSync(debDirectory);
  execFileSync(appImagePath, ["--appimage-extract"], {
    cwd: appImageDirectory,
    stdio: "ignore",
  });
  execFileSync("dpkg-deb", ["--extract", debPath, debDirectory]);
  return { appImageDirectory, debDirectory };
};

const assertDesktopEntry = (debDirectory: string) => {
  const path = getRequiredFile(debDirectory, "overmux-desktop.desktop");
  const entry = readFileSync(path, "utf8");
  [
    "Name=Overmux",
    "Exec=/opt/Overmux/overmux-desktop %U",
    "MimeType=x-scheme-handler/overmux;",
    "Categories=Development;",
  ].forEach((line) => {
    if (!entry.includes(line)) {
      throw new Error(`Desktop entry is missing ${line}`);
    }
  });
};

const verifyLinuxArtifacts = async () => {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Desktop Linux artifacts must be verified on Linux x86_64");
  }
  const artifacts = getLinuxReleaseArtifacts();
  assertDebMetadata(artifacts.debPath);
  const extracted = extractLinuxPackages(artifacts);
  const unpackedDirectory = resolve(releaseDirectory, "linux-unpacked");
  const directories = [
    unpackedDirectory,
    extracted.appImageDirectory,
    extracted.debDirectory,
  ];
  const archivePaths = directories.map((directory) =>
    getRequiredFile(directory, "app.asar"),
  );
  archivePaths.forEach(assertAppArchive);
  assertDesktopEntry(extracted.debDirectory);
  directories.forEach((directory) => {
    ["LICENSE.electron.txt", "LICENSES.chromium.html"].forEach((name) =>
      assertNonEmpty(getRequiredFile(directory, name)),
    );
    if (findFile(directory, "app-update.yml")) {
      throw new Error("Desktop package contains auto-update metadata");
    }
  });
  const archiveHashes = archivePaths.map(sha256);
  if (!archiveHashes.every((hash) => hash === archiveHashes[0])) {
    throw new Error("AppImage, Debian, and unpacked app.asar contents differ");
  }
  await assertFuses(resolve(unpackedDirectory, "overmux-desktop"));
  console.log(
    "Desktop Linux artifact contents, metadata, and fuses are valid.",
  );
};

const extractMacArtifact = (architecture: MacArchitecture) => {
  const artifactName = getMacDesktopArtifactName(
    packageMetadata.version,
    architecture,
  );
  const zipNames = readdirSync(releaseDirectory).filter((name) =>
    name.endsWith(".zip"),
  );
  assertEqual(
    JSON.stringify(zipNames),
    JSON.stringify([artifactName]),
    "Desktop macOS release artifacts",
  );
  const artifactPath = resolve(releaseDirectory, artifactName);
  assertNonEmpty(artifactPath);
  if (findFile(releaseDirectory, "app-update.yml")) {
    throw new Error("Desktop package contains auto-update metadata");
  }
  const extractionDirectory = resolve(
    temporaryDirectory,
    `mac-${architecture}`,
  );
  rmSync(extractionDirectory, { force: true, recursive: true });
  mkdirSync(extractionDirectory, { recursive: true });
  execFileSync("ditto", ["-x", "-k", artifactPath, extractionDirectory]);
  const bundlePath = resolve(extractionDirectory, "Overmux.app");
  if (!existsSync(bundlePath)) {
    throw new Error(`${artifactName} does not contain Overmux.app`);
  }
  return { artifactPath, bundlePath };
};

const assertMacBundleMetadata = (bundlePath: string) => {
  const infoPath = resolve(bundlePath, "Contents/Info.plist");
  const fields = [
    ["CFBundleIdentifier", "com.overmux.desktop"],
    ["CFBundleExecutable", "Overmux"],
    ["CFBundlePackageType", "APPL"],
  ] as const;
  fields.forEach(([field, expected]) => {
    const actual = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Print:${field}`, infoPath],
      { encoding: "utf8" },
    ).trim();
    assertEqual(actual, expected, `macOS bundle ${field}`);
  });
};

const verifyMacArtifacts = async (architecture: MacArchitecture) => {
  if (process.platform !== "darwin" || process.arch !== architecture) {
    throw new Error(
      `Desktop macOS ${architecture} artifacts must be verified on macOS ${architecture}`,
    );
  }
  const { bundlePath } = extractMacArtifact(architecture);
  assertMacBundleMetadata(bundlePath);
  const archivePath = resolve(bundlePath, "Contents/Resources/app.asar");
  assertAppArchive(archivePath);
  ["LICENSE", "LICENSES.chromium.html"].forEach((name) =>
    assertNonEmpty(resolve(bundlePath, "Contents/Resources/licenses", name)),
  );
  await assertFuses(resolve(bundlePath, "Contents/MacOS/Overmux"));
  console.log(
    `Desktop macOS ${architecture} artifact contents, metadata, and fuses are valid.`,
  );
};

export const validateDesktopArtifactNames = (
  names: readonly string[],
  version: string,
) => {
  const expected = getDesktopArtifactNames(version).sort();
  assertEqual(
    JSON.stringify([...names].sort()),
    JSON.stringify(expected),
    "Aggregated desktop release artifacts",
  );
};

const assertCompleteReleaseDirectory = () => {
  const names = readdirSync(releaseDirectory).filter(
    (name) =>
      name.endsWith(".AppImage") ||
      name.endsWith(".deb") ||
      name.endsWith(".zip"),
  );
  validateDesktopArtifactNames(names, packageMetadata.version);
  names.map((name) => resolve(releaseDirectory, name)).forEach(assertNonEmpty);
};

const writeChecksums = () => {
  assertCompleteReleaseDirectory();
  const checksums = getDesktopArtifactNames(packageMetadata.version)
    .sort()
    .map((name) => `${sha256(resolve(releaseDirectory, name))}  ${name}`)
    .join("\n");
  writeFileSync(resolve(releaseDirectory, "SHA256SUMS"), `${checksums}\n`);
  console.log("Wrote apps/desktop/release/SHA256SUMS");
};

const publishRelease = (tag: string, commit: string) => {
  validateDesktopReleaseTag(tag, packageMetadata.version);
  const state = readDesktopReleaseState(tag);
  if (state === "public") {
    console.log(
      `Desktop release ${tag} is already public; leaving it unchanged.`,
    );
    return;
  }
  validateDesktopReleaseCommit({ tag, commit });
  writeChecksums();
  const notes = `${getDesktopChangelogEntry(
    readFileSync(resolve(packageDirectory, "CHANGELOG.md"), "utf8"),
    packageMetadata.version,
  )}\n\nmacOS ZIPs are experimental unsigned, non-notarized previews. Verify SHA256SUMS before use.`;
  if (state === "missing") {
    execFileSync(
      "gh",
      [
        "release",
        "create",
        tag,
        "--draft",
        "--verify-tag",
        "--title",
        `Overmux Desktop ${packageMetadata.version}`,
        "--notes",
        notes,
      ],
      { stdio: "inherit" },
    );
  }

  const assets = [
    ...getDesktopArtifactNames(packageMetadata.version),
    "SHA256SUMS",
  ].map((name) => resolve(releaseDirectory, name));
  execFileSync("gh", ["release", "upload", tag, ...assets, "--clobber"], {
    stdio: "inherit",
  });
  execFileSync(
    "gh",
    ["release", "edit", tag, "--notes", notes, "--draft=false"],
    {
      stdio: "inherit",
    },
  );
};

const smokeTestLinux = () => {
  const [appImageName] = getLinuxDesktopArtifactNames(packageMetadata.version);
  const appImagePath = resolve(releaseDirectory, appImageName);
  const smokeDirectory = resolve(temporaryDirectory, "smoke-linux");
  rmSync(smokeDirectory, { force: true, recursive: true });
  mkdirSync(smokeDirectory, { recursive: true });
  execFileSync(appImagePath, ["--appimage-extract"], {
    cwd: smokeDirectory,
    stdio: "ignore",
  });
  const appDirectory = resolve(smokeDirectory, "squashfs-root");
  const result = spawnSync(
    resolve(appDirectory, "AppRun"),
    ["--disable-gpu", "--no-sandbox"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        APPDIR: appDirectory,
        XDG_STATE_HOME: resolve(smokeDirectory, "state"),
        OVERMUX_DESKTOP_SMOKE_TEST: "1",
      },
      timeout: 30_000,
    },
  );
  assertSmokeResult(result);
};

const assertSmokeResult = (result: ReturnType<typeof spawnSync>) => {
  const output = `${String(result.stdout ?? "")}${String(result.stderr ?? "")}`;
  if (
    result.error ||
    result.status !== 0 ||
    !output.includes("OVERMUX_DESKTOP_SMOKE_OK")
  ) {
    throw new Error(`Packaged desktop smoke test failed:\n${output}`, {
      cause: result.error,
    });
  }
  console.log("Packaged desktop application launched successfully.");
};

const smokeTestMac = (architecture: MacArchitecture) => {
  const { bundlePath } = extractMacArtifact(architecture);
  const signature = spawnSync("codesign", [
    "--verify",
    "--deep",
    "--strict",
    bundlePath,
  ]);
  if (signature.status !== 0) {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundlePath]);
  }
  const smokeDirectory = resolve(
    temporaryDirectory,
    `smoke-mac-${architecture}`,
  );
  mkdirSync(smokeDirectory, { recursive: true });
  const result = spawnSync(resolve(bundlePath, "Contents/MacOS/Overmux"), [], {
    encoding: "utf8",
    env: {
      ...process.env,
      XDG_STATE_HOME: resolve(smokeDirectory, "state"),
      OVERMUX_DESKTOP_SMOKE_TEST: "1",
    },
    timeout: 30_000,
  });
  assertSmokeResult(result);
};

const parseTarget = (value?: string): DesktopTarget => {
  if (value === "linux-x64" || value === "mac-arm64" || value === "mac-x64") {
    return value;
  }
  throw new Error(`Unknown desktop release target: ${value ?? "missing"}`);
};

const verifyTarget = async (target: DesktopTarget) => {
  if (target === "linux-x64") {
    await verifyLinuxArtifacts();
    return;
  }
  await verifyMacArtifacts(target === "mac-arm64" ? "arm64" : "x64");
};

const smokeTarget = (target: DesktopTarget) => {
  if (target === "linux-x64") {
    smokeTestLinux();
    return;
  }
  smokeTestMac(target === "mac-arm64" ? "arm64" : "x64");
};

const run = async () => {
  const [command, argument, commit] = process.argv.slice(2);
  if (command === "resolve-main") {
    resolveMainReleaseCommit();
    return;
  }
  if (command === "detect") {
    detectDesktopRelease(packageMetadata.version);
    return;
  }
  if (
    (command === "prepare" || command === "validate-source") &&
    argument &&
    commit
  ) {
    validateDesktopReleaseTag(argument, packageMetadata.version);
    if (command === "prepare") {
      prepareDesktopRelease(argument, commit);
    } else {
      validateDesktopReleaseCommit({ tag: argument, commit });
    }
    return;
  }
  if (command === "validate-tag" && argument) {
    validateDesktopReleaseTag(argument, packageMetadata.version);
    console.log(`Desktop release tag ${argument} matches package version.`);
    return;
  }
  if (command === "verify") {
    await verifyTarget(parseTarget(argument ?? "linux-x64"));
    return;
  }
  if (command === "checksums") {
    writeChecksums();
    return;
  }
  if (command === "smoke") {
    smokeTarget(parseTarget(argument ?? "linux-x64"));
    return;
  }
  if (command === "publish" && argument && commit) {
    publishRelease(argument, commit);
    return;
  }
  throw new Error(
    "Usage: desktop-release.ts <resolve-main|detect|prepare TAG COMMIT|validate-source TAG COMMIT|validate-tag TAG|verify TARGET|checksums|smoke TARGET|publish TAG COMMIT>",
  );
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await run();
}
