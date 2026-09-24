import { buildCommand } from "@stricli/core";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { getOvermuxPaths } from "../../server/paths";
import {
  createInitScaffold,
  initScaffoldPaths,
  type InitToolchain,
} from "./init-template";

const miseActivationDocs =
  "https://mise.jdx.dev/getting-started.html#activate-mise";
type CommandResult = {
  error?: NodeJS.ErrnoException;
  status: number | null;
  stderr: string;
  stdout: string;
};

export type InitDependencies = {
  directory: string;
  getLatestOvermuxVersion: () => Promise<string>;
  runCommand: (
    command: string,
    args: readonly string[],
    options?: { cwd?: string },
  ) => CommandResult;
  stderr: { write: (text: string) => unknown };
  stdout: { write: (text: string) => unknown };
};

const runCommand: InitDependencies["runCommand"] = (command, args, options) => {
  const result = spawnSync(command, args, {
    cwd: options?.cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    error: result.error,
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
};

const getLatestOvermuxVersion = async () => {
  const response = await fetch("https://registry.npmjs.org/overmux/latest", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Could not resolve the latest Overmux version: npm returned ${response.status}`,
    );
  }
  const body: unknown = await response.json();
  const version =
    typeof body === "object" && body !== null && "version" in body
      ? body.version
      : undefined;
  if (typeof version !== "string") {
    throw new Error("Could not resolve the latest Overmux version from npm");
  }
  return version;
};

const commandExists = (result: CommandResult) =>
  result.error?.code !== "ENOENT";

const isMiseActivated = (dependencies: InitDependencies) => {
  const doctor = dependencies.runCommand("mise", ["doctor", "--json"]);
  if (doctor.status !== 0) {
    return false;
  }
  try {
    const report: unknown = JSON.parse(doctor.stdout);
    return (
      typeof report === "object" &&
      report !== null &&
      "activated" in report &&
      report.activated === true
    );
  } catch {
    return false;
  }
};

const detectToolchain = (dependencies: InitDependencies): InitToolchain => {
  const mise = dependencies.runCommand("mise", ["--version"]);
  if (commandExists(mise)) {
    if (mise.status !== 0) {
      throw new Error(
        `Mise could not be validated. Activate mise and try again. ${miseActivationDocs}`,
      );
    }
    if (!isMiseActivated(dependencies)) {
      throw new Error(
        `Mise must be activated in your shell before running overmux init. ${miseActivationDocs}`,
      );
    }
    return "mise";
  }

  const pnpm = dependencies.runCommand("pnpm", ["--version"]);
  const major = Number.parseInt(pnpm.stdout.trim().split(".")[0] ?? "", 10);
  if (!commandExists(pnpm) || pnpm.status !== 0 || !Number.isFinite(major)) {
    throw new Error("pnpm 10 or newer is required when mise is not installed");
  }
  if (major < 10) {
    throw new Error(
      `pnpm 10 or newer is required when mise is not installed (found ${pnpm.stdout.trim()})`,
    );
  }
  return "pnpm";
};

const findCollisions = (directory: string) => {
  if (existsSync(directory) && !statSync(directory).isDirectory()) {
    return [directory];
  }
  return initScaffoldPaths.filter((path) => existsSync(join(directory, path)));
};

const writeScaffold = (
  directory: string,
  files: Readonly<Record<string, string>>,
) => {
  Object.entries(files).forEach(([path, content]) => {
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  });
};

const runProjectCommand = ({
  args,
  command,
  cwd,
  dependencies,
}: {
  args: readonly string[];
  command: string;
  cwd: string;
  dependencies: InitDependencies;
}) => {
  const result = dependencies.runCommand(command, args, { cwd });
  dependencies.stdout.write(result.stdout);
  dependencies.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
};

const pnpmCommands = [
  ["install", "--ignore-workspace"],
  ["exec", "overmux", "check", "--config", "./overmux.config.ts"],
] as const;

const installAndCheck = ({
  directory,
  dependencies,
  toolchain,
}: {
  directory: string;
  dependencies: InitDependencies;
  toolchain: InitToolchain;
}) => {
  const context = { cwd: directory, dependencies };
  if (toolchain === "mise") {
    runProjectCommand({
      ...context,
      command: "mise",
      args: ["install", "node@22", "pnpm@10", "--yes"],
    });
  }
  pnpmCommands.forEach((args) =>
    runProjectCommand({
      ...context,
      command: toolchain,
      args:
        toolchain === "mise"
          ? ["exec", "node@22", "pnpm@10", "--", "pnpm", ...args]
          : args,
    }),
  );
};

const mergeScaffold = (source: string, target: string) => {
  if (!existsSync(target)) {
    renameSync(source, target);
    return;
  }
  cpSync(source, target, {
    errorOnExist: true,
    force: false,
    recursive: true,
  });
};

export const initializeOvermux = async (dependencies: InitDependencies) => {
  const directory = resolve(dependencies.directory);
  const collisions = findCollisions(directory);
  if (collisions.length > 0) {
    throw new Error(
      `Refusing to overwrite existing files:\n${collisions.map((path) => `- ${path}`).join("\n")}`,
    );
  }

  const toolchain = detectToolchain(dependencies);
  const overmuxVersion = await dependencies.getLatestOvermuxVersion();
  const files = createInitScaffold({ overmuxVersion, toolchain });
  const parent = dirname(directory);
  mkdirSync(parent, { recursive: true });
  const stagingDirectory = mkdtempSync(join(parent, ".overmux-init-"));

  try {
    // Defer the npm tool entry so dependency installation uses the project-local Overmux binary.
    const installFiles = Object.fromEntries(
      Object.entries(files).filter(([path]) => path !== "mise.toml"),
    );
    writeScaffold(stagingDirectory, installFiles);
    installAndCheck({
      directory: stagingDirectory,
      dependencies,
      toolchain,
    });
    if (!existsSync(join(stagingDirectory, "pnpm-lock.yaml"))) {
      throw new Error("pnpm install did not generate pnpm-lock.yaml");
    }
    if (files["mise.toml"]) {
      writeFileSync(join(stagingDirectory, "mise.toml"), files["mise.toml"]);
    }
    mergeScaffold(stagingDirectory, directory);
  } finally {
    rmSync(stagingDirectory, { force: true, recursive: true });
  }

  dependencies.stdout.write(
    `Initialized Overmux in ${directory}\nNext: overmux serve\n`,
  );
};

export const createInitCommand = (process: NodeJS.Process) =>
  buildCommand({
    func: () =>
      initializeOvermux({
        directory: getOvermuxPaths({ environment: process.env }).configDir,
        getLatestOvermuxVersion,
        runCommand,
        stderr: process.stderr,
        stdout: process.stdout,
      }),
    parameters: { flags: {} },
    docs: {
      brief: "Create a minimal Overmux application",
    },
  });
