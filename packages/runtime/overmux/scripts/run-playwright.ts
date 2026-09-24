import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const packageDirectory = resolve(import.meta.dirname, "..");
const testTemporaryRoot = resolve(packageDirectory, "../../../.test-tmp");
const browserDirectory =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
    "ms-playwright",
  );

const runPlaywright = async () => {
  await mkdir(testTemporaryRoot, { recursive: true });
  const runDirectory = await mkdtemp(join(testTemporaryRoot, "playwright-"));
  const runtimeDirectory = join(runDirectory, "runtime");
  await mkdir(runtimeDirectory, { mode: 0o700 });
  await chmod(runtimeDirectory, 0o700);

  const environment = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browserDirectory,
    XDG_CACHE_HOME: join(runDirectory, "cache"),
    XDG_CONFIG_HOME: join(runDirectory, "config"),
    XDG_DATA_HOME: join(runDirectory, "data"),
    XDG_RUNTIME_DIR: runtimeDirectory,
    XDG_STATE_HOME: join(runDirectory, "state"),
  };
  try {
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      const child = spawn(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        [
          "exec",
          "playwright",
          "test",
          "--config",
          "playwright.config.ts",
          ...process.argv.slice(2),
        ],
        { cwd: packageDirectory, env: environment, stdio: "inherit" },
      );
      child.once("error", reject);
      child.once("exit", (code) => resolveExit(code ?? 1));
    });

    if (exitCode !== 0) {
      console.error(`Playwright artifacts retained at ${runDirectory}`);
      process.exitCode = exitCode;
      return;
    }

    await rm(runDirectory, { force: true, recursive: true });
  } catch (error) {
    console.error(`Playwright artifacts retained at ${runDirectory}`);
    throw error;
  }
};

await runPlaywright();
