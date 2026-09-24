import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { cpSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublishedManifest } from "./published-manifest.mts";
import { root, run, runOutput, text, type Build } from "./shared.mts";

const addonVersions = {
  fit: "0.11.0",
  unicode11: "0.9.0",
  webgl: "0.19.0",
  clipboard: "0.2.0",
  "web-links": "0.12.0",
} as const;

const listFiles = (directory: string, prefix = ""): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}${entry.name}`;
    return entry.isDirectory()
      ? listFiles(resolve(directory, entry.name), `${path}/`)
      : [path];
  });

const verifyEmbeddedSources = ({ stage }: Build) => {
  for (const mapName of ["xterm.js.map", "xterm.mjs.map"]) {
    const map = JSON.parse(text(resolve(stage, "lib", mapName))) as {
      sources: string[];
      sourcesContent: string[];
    };
    for (const path of [
      "src/browser/input/CompositionHelper.ts",
      "src/common/services/CoreService.ts",
      "src/browser/CoreBrowserTerminal.ts",
    ]) {
      const index = map.sources.findIndex((source) => source.endsWith(path));
      assert.ok(index >= 0, `${mapName} does not embed ${path}`);
      assert.equal(
        map.sourcesContent[index],
        text(resolve(stage, path)),
        `${mapName} source differs from shipped ${path}`,
      );
    }
  }
};

const verifyPackageContents = ({ stage }: Build, tarball: string) => {
  const entries = runOutput("tar", ["tzf", tarball], root).trim().split("\n");
  const staged = listFiles(stage)
    .map((path) => `package/${path}`)
    .sort();
  assert.deepEqual(
    entries.sort(),
    staged,
    "tarball entries differ from the staged allowlist",
  );
  assert.ok(
    entries.every((path) =>
      /^package\/(LICENSE|README\.md|FORK\.md|CHANGELOG\.md|package\.json|docs\/|css\/|lib\/|typings\/xterm\.d\.ts$|src\/)/.test(
        path,
      ),
    ),
    "tarball contains a non-allowlisted entry",
  );
  assert.ok(
    entries.includes("package/CHANGELOG.md"),
    "tarball misses release notes",
  );
  const artifact = JSON.parse(text(resolve(stage, "package.json")));
  const recipe = JSON.parse(text(resolve(root, "package.json")));
  assert.deepEqual(artifact, createPublishedManifest(recipe));
  for (const path of [
    artifact.main,
    artifact.module,
    artifact.types,
    artifact.style,
  ]) {
    assert.ok(
      entries.includes(`package/${path}`),
      `tarball misses public entry point: ${path}`,
    );
  }
  assert.ok(
    entries.includes("package/LICENSE") &&
      entries.includes("package/css/xterm.css") &&
      entries.includes("package/lib/xterm.js.map") &&
      entries.includes("package/lib/xterm.mjs.map") &&
      entries.includes("package/typings/xterm.d.ts"),
    "tarball misses required public files",
  );
};

const writeManifest = (
  directory: string,
  dependencies: Record<string, string>,
) => {
  writeFileSync(
    resolve(directory, "package.json"),
    `${JSON.stringify(
      {
        name: "consumer",
        private: true,
        type: "module",
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
};

const installConsumer = (directory: string) => {
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    directory,
  );
};

const typecheckConsumer = (source: string, directory: string) => {
  run(
    resolve(source, "node_modules/.bin/tsc"),
    [
      "--noEmit",
      "--strict",
      "--target",
      "es2022",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "consumer.ts",
    ],
    directory,
  );
};

const typecheckConsumers = ({ work, source }: Build, tarball: string) => {
  const fork = `file:${tarball}`;
  const addonConsumer = resolve(work, "consumer");
  const fixtures = [
    {
      directory: addonConsumer,
      file: "addon-consumer.ts",
      dependencies: {
        "@overmux/xterm-fork": fork,
        "@xterm/xterm": fork,
        ...Object.fromEntries(
          Object.entries(addonVersions).map(([name, version]) => [
            `@xterm/addon-${name}`,
            version,
          ]),
        ),
      },
    },
    {
      directory: resolve(work, "direct-consumer"),
      file: "direct-consumer.ts",
      dependencies: { "@overmux/xterm-fork": fork },
    },
  ];
  for (const { directory, file, dependencies } of fixtures) {
    mkdirSync(directory, { recursive: true });
    writeManifest(directory, dependencies);
    cpSync(resolve(root, "tests", file), resolve(directory, "consumer.ts"));
    installConsumer(directory);
    typecheckConsumer(source, directory);
  }
  return addonConsumer;
};

const testBrowserBehavior = ({ source }: Build, consumer: string) => {
  if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    run(
      resolve(root, "node_modules/.bin/playwright"),
      ["install", "--with-deps", "chromium"],
      root,
    );
    // Use the workspace installer for current Ubuntu packages; upstream's old installer assumes libasound2.
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = chromium.executablePath();
  }
  const forkTests = resolve(source, "test/fork");
  mkdirSync(forkTests, { recursive: true });
  for (const file of ["input-transform.e2e.test.ts", "playwright.config.ts"]) {
    cpSync(resolve(root, "tests", file), resolve(forkTests, file));
  }
  const paths = {
    "@overmux/xterm-fork": [
      resolve(consumer, "node_modules/@overmux/xterm-fork/typings/xterm.d.ts"),
    ],
    "@xterm/xterm": [
      resolve(consumer, "node_modules/@xterm/xterm/typings/xterm.d.ts"),
    ],
  };
  writeFileSync(
    resolve(forkTests, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "es2022",
          module: "nodenext",
          moduleResolution: "nodenext",
          baseUrl: ".",
          paths,
        },
        include: ["input-transform.e2e.test.ts"],
      },
      null,
      2,
    )}\n`,
  );
  run(
    resolve(source, "node_modules/.bin/tsc"),
    ["--noEmit", "-p", "test/fork/tsconfig.json"],
    source,
  );
  process.env.FORK_CONSUMER_ROOT = consumer;
  run(
    resolve(source, "node_modules/.bin/playwright"),
    ["test", "--config", resolve(forkTests, "playwright.config.ts")],
    source,
  );
};

const runUpstreamTests = ({ source }: Build) => run("npm", ["test"], source);

export const verifyPackage = (build: Build, tarball: string) => {
  verifyEmbeddedSources(build);
  verifyPackageContents(build, tarball);
  const consumer = typecheckConsumers(build, tarball);
  testBrowserBehavior(build, consumer);
  runUpstreamTests(build);
};
