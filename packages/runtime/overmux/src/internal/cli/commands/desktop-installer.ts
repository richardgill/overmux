import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  downloadTextAsset,
  downloadVerifiedAsset,
  findDesktopRelease,
  parseSha256Sums,
  type DesktopArchitecture,
  type DesktopRelease,
} from "./desktop-release";

export type DesktopAction = "install" | "upgrade";

type CommandResult = { status: number | null; stderr: string; stdout: string };
export type DesktopInstallerDependencies = {
  arch: string;
  confirm: () => Promise<boolean>;
  downloadText: (asset: DesktopRelease["checksums"]) => Promise<string>;
  downloadVerified: typeof downloadVerifiedAsset;
  findRelease: (architecture: DesktopArchitecture) => Promise<DesktopRelease>;
  homeDirectory: string;
  platform: string;
  runCommand: (command: string, args: readonly string[]) => CommandResult;
  sleep: (milliseconds: number) => Promise<void>;
  stderr: Pick<NodeJS.WriteStream, "write">;
  stdout: Pick<NodeJS.WriteStream, "write">;
};

type DesktopInstallOptions = {
  action: DesktopAction;
  yes?: boolean;
};

const bundleIdentifier = "com.overmux.desktop";
const bundleName = "Overmux.app";

const runCommand = (
  command: string,
  args: readonly string[],
): CommandResult => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`Could not run ${command}`, { cause: result.error });
  }
  return {
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
};

const requireCommand = (
  dependencies: DesktopInstallerDependencies,
  command: string,
  args: readonly string[],
) => {
  const result = dependencies.runCommand(command, args);
  if (result.status !== 0) {
    throw new Error(
      `${basename(command)} failed: ${result.stderr.trim() || "unknown error"}`,
    );
  }
  return result.stdout.trim();
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const confirmUnsignedInstall = async (process: NodeJS.Process) => {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new Error(
      "Unsigned desktop installation requires an interactive terminal; rerun with --yes to accept the risk",
    );
  }
  process.stdout.write(
    "Overmux Desktop for macOS is experimental, unsigned, and not notarized. macOS cannot verify its publisher.\n",
  );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await prompt.question(
    "Install this unsigned application? [y/N] ",
  );
  prompt.close();
  return /^(?:y|yes)$/i.test(answer.trim());
};

const createDependencies = (
  process: NodeJS.Process,
): DesktopInstallerDependencies => ({
  arch: process.arch,
  confirm: () => confirmUnsignedInstall(process),
  downloadText: downloadTextAsset,
  downloadVerified: downloadVerifiedAsset,
  findRelease: findDesktopRelease,
  homeDirectory: homedir(),
  platform: process.platform,
  runCommand,
  sleep,
  stderr: process.stderr,
  stdout: process.stdout,
});

const getArchitecture = (arch: string): DesktopArchitecture => {
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }
  throw new Error(`Overmux Desktop does not provide a macOS ${arch} build`);
};

const assertApplicationsDirectory = (path: string) => {
  if (!existsSync(path)) {
    return;
  }
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Refusing unsafe user Applications directory: ${path}`);
  }
};

export const validateDesktopZipEntries = (entries: readonly string[]) => {
  if (entries.length === 0) {
    throw new Error("Desktop ZIP is empty");
  }
  entries.forEach((entry) => {
    const path = entry.endsWith("/") ? entry.slice(0, -1) : entry;
    const segments = path.split("/");
    if (
      !path ||
      path.includes("\\") ||
      path.includes("\0") ||
      isAbsolute(path) ||
      segments.some(
        (segment) => !segment || segment === "." || segment === "..",
      ) ||
      segments[0] !== bundleName
    ) {
      throw new Error(`Desktop ZIP contains an unsafe path: ${entry}`);
    }
  });
};

const assertSafeBundleTree = (bundlePath: string, directory = bundlePath) => {
  readdirSync(directory).forEach((name) => {
    const path = resolve(directory, name);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) {
      const target = readlinkSync(path);
      const resolvedTarget = resolve(dirname(path), target);
      const targetRelative = relative(bundlePath, resolvedTarget);
      if (isAbsolute(target) || targetRelative.startsWith("..")) {
        throw new Error(
          `Desktop bundle contains an unsafe symbolic link: ${path}`,
        );
      }
      return;
    }
    if (metadata.isDirectory()) {
      assertSafeBundleTree(bundlePath, path);
      return;
    }
    if (!metadata.isFile()) {
      throw new Error(`Desktop bundle contains an unsupported file: ${path}`);
    }
  });
};

export const verifyDesktopBundle = (
  bundlePath: string,
  dependencies: Pick<DesktopInstallerDependencies, "runCommand">,
) => {
  const metadata = lstatSync(bundlePath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${bundlePath} is not an application bundle directory`);
  }
  assertSafeBundleTree(bundlePath);
  const infoPath = resolve(bundlePath, "Contents/Info.plist");
  const fields = [
    ["CFBundleIdentifier", bundleIdentifier],
    ["CFBundleExecutable", "Overmux"],
    ["CFBundlePackageType", "APPL"],
  ] as const;
  fields.forEach(([field, expected]) => {
    const result = dependencies.runCommand("/usr/libexec/PlistBuddy", [
      "-c",
      `Print:${field}`,
      infoPath,
    ]);
    if (result.status !== 0 || result.stdout.trim() !== expected) {
      throw new Error(`Refusing application bundle with invalid ${field}`);
    }
  });
};

const extractAndVerifyBundle = ({
  archivePath,
  dependencies,
  stagingDirectory,
}: {
  archivePath: string;
  dependencies: DesktopInstallerDependencies;
  stagingDirectory: string;
}) => {
  const listing = requireCommand(dependencies, "/usr/bin/unzip", [
    "-Z1",
    archivePath,
  ]);
  validateDesktopZipEntries(listing.split(/\r?\n/));
  const extractionDirectory = resolve(stagingDirectory, "extracted");
  mkdirSync(extractionDirectory);
  requireCommand(dependencies, "/usr/bin/ditto", [
    "-x",
    "-k",
    archivePath,
    extractionDirectory,
  ]);
  const topLevelEntries = readdirSync(extractionDirectory);
  if (topLevelEntries.length !== 1 || topLevelEntries[0] !== bundleName) {
    throw new Error("Desktop ZIP must contain only Overmux.app");
  }
  const bundlePath = resolve(extractionDirectory, bundleName);
  verifyDesktopBundle(bundlePath, dependencies);
  return bundlePath;
};

const prepareSignature = (
  bundlePath: string,
  dependencies: DesktopInstallerDependencies,
) => {
  const verification = dependencies.runCommand("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    bundlePath,
  ]);
  if (verification.status !== 0) {
    requireCommand(dependencies, "/usr/bin/codesign", [
      "--force",
      "--deep",
      "--sign",
      "-",
      bundlePath,
    ]);
  }
  requireCommand(dependencies, "/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    bundlePath,
  ]);
  const quarantineRemoval = dependencies.runCommand("/usr/bin/xattr", [
    "-dr",
    "com.apple.quarantine",
    bundlePath,
  ]);
  if (quarantineRemoval.status !== 0 && quarantineRemoval.status !== 1) {
    throw new Error(
      `Could not remove quarantine: ${quarantineRemoval.stderr.trim()}`,
    );
  }
};

const waitForDesktopExit = async (
  dependencies: DesktopInstallerDependencies,
  attemptsRemaining: number,
): Promise<void> => {
  const result = dependencies.runCommand("/usr/bin/pgrep", ["-x", "Overmux"]);
  if (result.status === 1) {
    return;
  }
  if (result.status !== 0) {
    throw new Error(
      `Could not confirm that Overmux quit: ${result.stderr.trim()}`,
    );
  }
  if (attemptsRemaining === 0) {
    throw new Error("Overmux did not quit; close it and retry the upgrade");
  }
  await dependencies.sleep(100);
  return waitForDesktopExit(dependencies, attemptsRemaining - 1);
};

const stopRunningDesktop = async (
  dependencies: DesktopInstallerDependencies,
) => {
  const running = dependencies.runCommand("/usr/bin/pgrep", ["-x", "Overmux"]);
  if (running.status === 1) {
    return;
  }
  if (running.status !== 0) {
    throw new Error(
      `Could not determine whether Overmux is running: ${running.stderr.trim()}`,
    );
  }
  requireCommand(dependencies, "/usr/bin/osascript", [
    "-e",
    `tell application id "${bundleIdentifier}" to quit`,
  ]);
  await waitForDesktopExit(dependencies, 50);
};

const launchDesktop = (
  destination: string,
  dependencies: DesktopInstallerDependencies,
) => requireCommand(dependencies, "/usr/bin/open", [destination]);

const replaceDesktop = async ({
  action,
  bundlePath,
  dependencies,
  destination,
  stagingDirectory,
}: {
  action: DesktopAction;
  bundlePath: string;
  dependencies: DesktopInstallerDependencies;
  destination: string;
  stagingDirectory: string;
}) => {
  const backupPath = resolve(stagingDirectory, "Overmux.previous.app");
  if (action === "upgrade") {
    verifyDesktopBundle(destination, dependencies);
    await stopRunningDesktop(dependencies);
    renameSync(destination, backupPath);
  } else if (existsSync(destination)) {
    throw new Error(
      `${destination} appeared during installation; no files were replaced`,
    );
  }
  try {
    renameSync(bundlePath, destination);
    launchDesktop(destination, dependencies);
  } catch (error) {
    rmSync(destination, { force: true, recursive: true });
    if (action === "upgrade" && existsSync(backupPath)) {
      renameSync(backupPath, destination);
      try {
        launchDesktop(destination, dependencies);
      } catch {
        dependencies.stderr.write(
          "Restored the previous Overmux.app but could not relaunch it.\n",
        );
      }
    }
    throw error;
  }
};

export const installDesktop = async (
  options: DesktopInstallOptions,
  overrides: Partial<DesktopInstallerDependencies> = {},
  process = globalThis.process,
) => {
  const dependencies = { ...createDependencies(process), ...overrides };
  if (dependencies.platform !== "darwin") {
    throw new Error(
      "Overmux desktop install and upgrade are only available on macOS",
    );
  }
  const architecture = getArchitecture(dependencies.arch);
  const applicationsDirectory = resolve(
    dependencies.homeDirectory,
    "Applications",
  );
  assertApplicationsDirectory(applicationsDirectory);
  const destination = resolve(applicationsDirectory, bundleName);
  const exists = existsSync(destination);
  if (options.action === "install" && exists) {
    throw new Error(
      `${destination} already exists; run overmux desktop upgrade`,
    );
  }
  if (options.action === "upgrade" && !exists) {
    throw new Error(
      `${destination} is not installed; run overmux desktop install`,
    );
  }
  if (options.action === "upgrade") {
    verifyDesktopBundle(destination, dependencies);
  }
  if (
    options.action === "install" &&
    !options.yes &&
    !(await dependencies.confirm())
  ) {
    throw new Error("Desktop installation cancelled");
  }

  mkdirSync(applicationsDirectory, { recursive: true });
  assertApplicationsDirectory(applicationsDirectory);
  const stagingDirectory = mkdtempSync(
    resolve(applicationsDirectory, ".overmux-install-"),
  );
  try {
    const release = await dependencies.findRelease(architecture);
    const checksums = parseSha256Sums(
      await dependencies.downloadText(release.checksums),
    );
    const expectedSha256 = checksums.get(release.artifact.name);
    if (!expectedSha256) {
      throw new Error(
        `${release.tag} SHA256SUMS does not contain ${release.artifact.name}`,
      );
    }
    const archivePath = resolve(stagingDirectory, release.artifact.name);
    await dependencies.downloadVerified({
      asset: release.artifact,
      destination: archivePath,
      expectedSha256,
    });
    const bundlePath = extractAndVerifyBundle({
      archivePath,
      dependencies,
      stagingDirectory,
    });
    prepareSignature(bundlePath, dependencies);
    await replaceDesktop({
      action: options.action,
      bundlePath,
      dependencies,
      destination,
      stagingDirectory,
    });
    dependencies.stdout.write(
      `${options.action === "install" ? "Installed" : "Upgraded"} and launched ${destination} (${release.version}).\n`,
    );
  } finally {
    rmSync(stagingDirectory, { force: true, recursive: true });
  }
};
