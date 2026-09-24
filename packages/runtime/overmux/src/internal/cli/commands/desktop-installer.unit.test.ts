import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import {
  beforeEach,
  describe,
  expect,
  it,
  test as testCases,
  vi,
} from "vitest";

import {
  installDesktop,
  type DesktopInstallerDependencies,
  validateDesktopZipEntries,
} from "./desktop-installer";

const testDirectory = resolve(
  import.meta.dirname,
  "../../../../../../../.test-tmp/desktop-installer",
);
const checksum = "a".repeat(64);
const artifactName = "Overmux-Desktop-1.2.3-mac-arm64.zip";

const createBundle = (path: string, marker = "new") => {
  mkdirSync(resolve(path, "Contents"), { recursive: true });
  writeFileSync(resolve(path, "Contents/Info.plist"), marker);
};

const createDependencies = (
  overrides: Partial<DesktopInstallerDependencies> = {},
) => {
  const output: string[] = [];
  const dependencies: DesktopInstallerDependencies = {
    arch: "arm64",
    confirm: vi.fn(async () => true),
    downloadText: vi.fn(async () => `${checksum}  ${artifactName}\n`),
    downloadVerified: vi.fn(async ({ destination }) => {
      writeFileSync(destination, "archive");
    }),
    findRelease: vi.fn(async () => ({
      artifact: {
        browser_download_url: `https://github.com/richardgill/overmux/releases/download/desktop-v1.2.3/${artifactName}`,
        name: artifactName,
        size: 7,
      },
      checksums: {
        browser_download_url:
          "https://github.com/richardgill/overmux/releases/download/desktop-v1.2.3/SHA256SUMS",
        name: "SHA256SUMS",
        size: 80,
      },
      tag: "desktop-v1.2.3",
      version: "1.2.3",
    })),
    homeDirectory: testDirectory,
    platform: "darwin",
    runCommand: vi.fn((command, args) => {
      const commandName = basename(command);
      if (commandName === "unzip") {
        return {
          status: 0,
          stderr: "",
          stdout: "Overmux.app/\nOvermux.app/Contents/Info.plist\n",
        };
      }
      if (commandName === "ditto") {
        createBundle(resolve(args.at(-1) as string, "Overmux.app"));
      }
      if (commandName === "PlistBuddy") {
        const field = args[1];
        const values: Record<string, string> = {
          "Print:CFBundleExecutable": "Overmux",
          "Print:CFBundleIdentifier": "com.overmux.desktop",
          "Print:CFBundlePackageType": "APPL",
        };
        return { status: 0, stderr: "", stdout: values[field] };
      }
      if (commandName === "pgrep") {
        return { status: 1, stderr: "", stdout: "" };
      }
      if (commandName === "xattr") {
        return { status: 1, stderr: "", stdout: "" };
      }
      return { status: 0, stderr: "", stdout: "" };
    }),
    sleep: vi.fn(async () => undefined),
    stderr: { write: vi.fn((text) => output.push(String(text))) } as never,
    stdout: { write: vi.fn((text) => output.push(String(text))) } as never,
    ...overrides,
  };
  return { dependencies, output };
};

describe("desktop ZIP paths", () => {
  it("accepts one rooted Overmux.app tree", () => {
    expect(() =>
      validateDesktopZipEntries([
        "Overmux.app/",
        "Overmux.app/Contents/MacOS/Overmux",
      ]),
    ).not.toThrow();
  });

  testCases.each([
    "../Overmux.app/Contents/file",
    "/Overmux.app/Contents/file",
    "Other.app/Contents/file",
    "Overmux.app/../outside",
    "Overmux.app\\Contents\\file",
  ])("rejects unsafe archive path %s", (path) => {
    expect(() => validateDesktopZipEntries([path])).toThrow("unsafe path");
  });
});

describe("macOS desktop installer", () => {
  beforeEach(() => {
    rmSync(testDirectory, { force: true, recursive: true });
    mkdirSync(testDirectory, { recursive: true });
  });

  it("guards unsupported platforms before doing release work", async () => {
    const { dependencies } = createDependencies({ platform: "linux" });

    await expect(
      installDesktop({ action: "install", yes: true }, dependencies),
    ).rejects.toThrow("only available on macOS");
    expect(dependencies.findRelease).not.toHaveBeenCalled();
  });

  it("refuses a user Applications directory redirected by a symbolic link", async () => {
    const redirected = resolve(testDirectory, "redirected");
    mkdirSync(redirected);
    symlinkSync(redirected, resolve(testDirectory, "Applications"));
    const { dependencies } = createDependencies();

    await expect(
      installDesktop({ action: "install", yes: true }, dependencies),
    ).rejects.toThrow("unsafe user Applications directory");
    expect(dependencies.findRelease).not.toHaveBeenCalled();
  });

  it("requires confirmation and installs only in the user Applications directory", async () => {
    const { dependencies, output } = createDependencies();

    await installDesktop({ action: "install" }, dependencies);

    const destination = resolve(testDirectory, "Applications/Overmux.app");
    expect(dependencies.confirm).toHaveBeenCalledOnce();
    expect(existsSync(destination)).toBe(true);
    expect(output.join("")).toContain(`Installed and launched ${destination}`);
  });

  it("supports --yes and refuses to overwrite an existing install", async () => {
    const first = createDependencies();
    await installDesktop({ action: "install", yes: true }, first.dependencies);
    expect(first.dependencies.confirm).not.toHaveBeenCalled();

    const second = createDependencies();
    await expect(
      installDesktop({ action: "install", yes: true }, second.dependencies),
    ).rejects.toThrow("run overmux desktop upgrade");
    expect(second.dependencies.findRelease).not.toHaveBeenCalled();
  });

  it("verifies and replaces an existing bundle during upgrade", async () => {
    const destination = resolve(testDirectory, "Applications/Overmux.app");
    createBundle(destination, "old");
    const { dependencies, output } = createDependencies();

    await installDesktop({ action: "upgrade" }, dependencies);

    expect(
      readFileSync(resolve(destination, "Contents/Info.plist"), "utf8"),
    ).toBe("new");
    expect(output.join("")).toContain("Upgraded and launched");
  });

  it("refuses to replace an existing bundle with another identity", async () => {
    createBundle(resolve(testDirectory, "Applications/Overmux.app"), "old");
    const base = createDependencies();
    const runCommand = vi.fn((command: string, args: readonly string[]) => {
      if (basename(command) === "PlistBuddy") {
        return { status: 0, stderr: "", stdout: "other.application" };
      }
      return base.dependencies.runCommand(command, args);
    });

    await expect(
      installDesktop(
        { action: "upgrade" },
        { ...base.dependencies, runCommand },
      ),
    ).rejects.toThrow("invalid CFBundleIdentifier");
    expect(base.dependencies.findRelease).not.toHaveBeenCalled();
  });

  it("asks a running app to quit and waits before replacing it", async () => {
    const destination = resolve(testDirectory, "Applications/Overmux.app");
    createBundle(destination, "old");
    const base = createDependencies();
    const pgrepStatuses = [0, 0, 1];
    const runCommand = vi.fn((command: string, args: readonly string[]) => {
      if (basename(command) === "pgrep") {
        return { status: pgrepStatuses.shift() ?? 1, stderr: "", stdout: "" };
      }
      return base.dependencies.runCommand(command, args);
    });

    await installDesktop(
      { action: "upgrade" },
      { ...base.dependencies, runCommand },
    );

    expect(runCommand).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      expect.any(Array),
    );
    expect(base.dependencies.sleep).toHaveBeenCalledWith(100);
  });

  it("restores the previous bundle when launching the upgrade fails", async () => {
    const destination = resolve(testDirectory, "Applications/Overmux.app");
    createBundle(destination, "old");
    const base = createDependencies();
    let openCalls = 0;
    const runCommand = vi.fn((command: string, args: readonly string[]) => {
      if (basename(command) === "open") {
        openCalls += 1;
        return openCalls === 1
          ? { status: 1, stderr: "launch failed", stdout: "" }
          : { status: 0, stderr: "", stdout: "" };
      }
      return base.dependencies.runCommand(command, args);
    });

    await expect(
      installDesktop(
        { action: "upgrade" },
        { ...base.dependencies, runCommand },
      ),
    ).rejects.toThrow("launch failed");
    expect(
      readFileSync(resolve(destination, "Contents/Info.plist"), "utf8"),
    ).toBe("old");
    expect(openCalls).toBe(2);
  });
});
