import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repositoryRoot = resolve(import.meta.dirname, "../../../../../..");
const packageDirectories = [
  "packages/runtime/overmux",
  "packages/ecosystem/keybindings",
];

const packConsumerDependencies = async (directory: string) => {
  const dependencies: Record<string, string> = {};
  for (const path of packageDirectories) {
    const cwd = resolve(repositoryRoot, path);
    const { name } = JSON.parse(
      await readFile(resolve(cwd, "package.json"), "utf8"),
    );
    const { stdout } = await execFileAsync(
      "pnpm",
      ["pack", "--pack-destination", directory, "--json"],
      { cwd },
    );
    const { filename } = JSON.parse(stdout);
    dependencies[name] = `file:${resolve(directory, filename)}`;
  }
  return dependencies;
};

const installConsumer = async (directory: string) => {
  const dependencies = await packConsumerDependencies(directory);
  for (const name of [
    "react",
    "react-dom",
    "vite",
    "typescript",
    "@types/node",
    "@types/react",
    "@types/react-dom",
  ]) {
    dependencies[name] = require(`${name}/package.json`).version;
  }
  await writeFile(
    resolve(directory, "package.json"),
    JSON.stringify({
      name: "zod-consumer",
      private: true,
      type: "module",
      dependencies: { ...dependencies, zod: "4.6.5" },
    }),
  );
  // npm installs real tarballs without workspace links, aliases, or overrides.
  await execFileAsync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ],
    { cwd: directory },
  );
};

it("accepts application-owned Zod schemas through independently installed public APIs", async () => {
  const temporaryRoot = resolve(repositoryRoot, ".test-tmp/zod-consumer");
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(resolve(temporaryRoot, "consumer-"));
  try {
    await installConsumer(directory);
    for (const name of ["overmux", "@overmux/keybindings"]) {
      const manifest = JSON.parse(
        await readFile(
          resolve(directory, "node_modules", name, "package.json"),
          "utf8",
        ),
      );
      expect(manifest.peerDependencies.zod).toBe("^4.6.5");
      expect(manifest.dependencies?.zod).toBeUndefined();
    }
    // This fixture is excluded from the workspace typecheck: only installed
    // declarations should satisfy its imports, never source aliases or build races.
    await copyFile(
      new URL("./fixtures/zod-consumer.ts", import.meta.url),
      resolve(directory, "consumer.ts"),
    );
    await writeFile(
      resolve(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          module: "NodeNext",
          target: "ES2022",
          types: ["node"],
        },
        files: ["consumer.ts"],
      }),
    );
    await execFileAsync(
      process.execPath,
      ["node_modules/typescript/bin/tsc", "--project", "tsconfig.json"],
      { cwd: directory },
    );
    const { stdout } = await execFileAsync(process.execPath, ["consumer.ts"], {
      cwd: directory,
    });
    expect(stdout).toContain(
      "Application Zod schemas work with packed Overmux APIs",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
