import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { afterExtract } from "./preserve-electron-licenses.ts";

const temporaryRoot = resolve(import.meta.dirname, "../../../.test-tmp");
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("preserves Electron's macOS notices inside the bundle before renaming", async () => {
  await mkdir(temporaryRoot, { recursive: true });
  const appOutDir = await mkdtemp(resolve(temporaryRoot, "electron-licenses-"));
  directories.push(appOutDir);
  const notices = ["LICENSE", "LICENSES.chromium.html"];
  await Promise.all(
    notices.map((name) =>
      writeFile(resolve(appOutDir, name), `Upstream ${name}`),
    ),
  );

  await afterExtract({ appOutDir, electronPlatformName: "darwin" });

  for (const name of notices) {
    expect(
      await readFile(
        resolve(appOutDir, "Electron.app/Contents/Resources/licenses", name),
        "utf8",
      ),
    ).toBe(`Upstream ${name}`);
  }
});

it("does not let macOS packaging silently omit upstream notices", async () => {
  await mkdir(temporaryRoot, { recursive: true });
  const appOutDir = await mkdtemp(resolve(temporaryRoot, "electron-licenses-"));
  directories.push(appOutDir);

  await expect(
    afterExtract({ appOutDir, electronPlatformName: "darwin" }),
  ).rejects.toThrow();
});
