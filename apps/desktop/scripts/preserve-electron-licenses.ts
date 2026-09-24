import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AfterPackContext } from "electron-builder";

// electron-builder removes the macOS archive's top-level notices when renaming
// Electron.app. Preserve them inside the bundle before that packaging step.
// https://github.com/electron-userland/electron-builder/blob/v26.8.1/packages/app-builder-lib/src/electron/electronMac.ts
export const afterExtract = async ({
  appOutDir,
  electronPlatformName,
}: Pick<AfterPackContext, "appOutDir" | "electronPlatformName">) => {
  if (electronPlatformName !== "darwin") {
    return;
  }
  const destination = join(
    appOutDir,
    "Electron.app/Contents/Resources/licenses",
  );
  await mkdir(destination, { recursive: true });
  await Promise.all(
    ["LICENSE", "LICENSES.chromium.html"].map((name) =>
      copyFile(join(appOutDir, name), join(destination, name)),
    ),
  );
};
