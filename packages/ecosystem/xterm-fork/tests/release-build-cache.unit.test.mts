import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/shared.mts";

const repository = resolve(root, "../../..");
const forkPath = "packages/ecosystem/xterm-fork";
const runtimeDoc =
  "packages/runtime/overmux/docs/400-reference/700-cli/600-docs.md";
const aiContext = "packages/runtime/ai-context/src/index.ts";
const runtimeSource = "packages/runtime/overmux/src/public/index.ts";

const cacheFixture = (t: { after: (fn: () => void) => void }) => {
  mkdirSync(resolve(root, ".test-tmp"), { recursive: true });
  const cwd = mkdtempSync(resolve(root, ".test-tmp/build-cache-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  // Use the real workspace graph and lockfile, without artifacts or dependency installs.
  const paths = [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "turbo.json",
    ".node-version",
    "mise.toml",
    "README.md",
    runtimeDoc,
    runtimeSource,
    aiContext,
    "scripts/generate-ai-context-docs.ts",
    ...globSync(
      [
        "packages/*/*/package.json",
        "apps/*/package.json",
        "tooling/*/package.json",
        "fixtures/package.json",
        "e2e/fixtures/package.json",
      ],
      { cwd: repository },
    ),
    ...globSync(["upstream.ts", "scripts/*", "patches/*", "*.md", "docs/*"], {
      cwd: root,
    }).map((path) => `${forkPath}/${path}`),
  ];
  for (const path of paths) {
    mkdirSync(dirname(resolve(cwd, path)), { recursive: true });
    cpSync(resolve(repository, path), resolve(cwd, path));
  }
  execFileSync("git", ["init", "--quiet"], { cwd });
  execFileSync("git", ["add", "."], { cwd });
  return cwd;
};

type Task = { taskId: string; hash: string; dependencies: string[] };
const tasks = (cwd: string): Task[] =>
  JSON.parse(
    execFileSync(
      resolve(repository, "node_modules/.bin/turbo"),
      ["run", "typecheck", "--dry=json"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  ).tasks;
const task = (tasks: Task[], id: string) => {
  const result = tasks.find((task) => task.taskId === id);
  assert.ok(result, `missing task ${id}`);
  return result;
};

test("typecheck builds the fork and hashes only relevant build inputs", (t) => {
  const cwd = cacheFixture(t);
  const before = tasks(cwd);
  const fork = "@overmux/xterm-fork#build";
  const runtime = "overmux#build";
  const website = "@overmux/www#typecheck";
  assert.ok(
    task(before, "@overmux/xterm#typecheck").dependencies.includes(fork),
  );

  const testCases = [
    { path: "README.md", expectedChanges: { [fork]: false, [runtime]: false } },
    {
      path: runtimeDoc,
      expectedChanges: { [fork]: false, [runtime]: true, [website]: true },
    },
    {
      path: runtimeSource,
      expectedChanges: { [fork]: false, [runtime]: true },
    },
    {
      path: aiContext,
      expectedChanges: { [fork]: false, [runtime]: true, [website]: true },
    },
    {
      path: "scripts/generate-ai-context-docs.ts",
      expectedChanges: { [fork]: false, [runtime]: true, [website]: true },
    },
    { path: `${forkPath}/CONTRIBUTING.md`, expectedChanges: { [fork]: false } },
    { path: `${forkPath}/upstream.ts`, expectedChanges: { [fork]: true } },
    {
      path: `${forkPath}/patches/input-transform.patch`,
      expectedChanges: { [fork]: true },
    },
    {
      path: `${forkPath}/scripts/build.mts`,
      expectedChanges: { [fork]: true },
    },
    { path: `${forkPath}/README.md`, expectedChanges: { [fork]: true } },
    { path: ".node-version", expectedChanges: { [fork]: true } },
    { path: "mise.toml", expectedChanges: { [fork]: true } },
    {
      path: `${forkPath}/package.json`,
      expectedChanges: { [fork]: true },
      replacement: ['"node":', '"cache-probe": "true", "node":'],
    },
    {
      path: "pnpm-lock.yaml",
      expectedChanges: { [fork]: true },
      replacement: ["1.58.0", "1.58.1"],
    },
  ];
  for (const { path, expectedChanges, replacement } of testCases) {
    const file = resolve(cwd, path);
    const original = readFileSync(file, "utf8");
    try {
      writeFileSync(
        file,
        replacement
          ? original.replaceAll(replacement[0], replacement[1])
          : `${original}\n// cache probe\n`,
      );
      const after = tasks(cwd);
      for (const [taskId, changed] of Object.entries(expectedChanges)) {
        assert.equal(
          task(after, taskId).hash !== task(before, taskId).hash,
          changed,
          `${path}: ${taskId}`,
        );
      }
    } finally {
      writeFileSync(file, original);
    }
  }
});
