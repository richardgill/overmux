import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, resolve, sep } from "node:path";
import { upstream } from "../upstream.ts";
import { verifyPackage } from "./verify.mts";
import { createPublishedManifest } from "./published-manifest.mts";
import { validateVersionBase } from "./versioning.mts";
import { root, run, runOutput, text, type Build } from "./shared.mts";

process.env.NODE_OPTIONS =
  process.env.NODE_OPTIONS ?? "--max-old-space-size=4096";
const command = process.argv[2] ?? "build";
assert.ok(["build", "pack"].includes(command), `Unknown command: ${command}`);

const packageVersion = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).version;
const artifactName = `overmux-xterm-fork-${packageVersion}.tgz`;

const createBuildWorkspace = () => {
  const parent = resolve(
    process.env.XTERM_RECIPE_WORKDIR ??
      resolve(homedir(), "code/noisy-files/overmux-xterm-builds"),
  );
  const repositories = [resolve(root, "../../..")];
  assert.ok(
    !repositories.some(
      (path) => parent === path || parent.startsWith(`${path}${sep}`),
    ),
    `scratch must be outside repositories: ${parent}`,
  );
  mkdirSync(parent, { recursive: true });
  // Each build gets independent inputs, even with an explicit scratch root. Never delete caller directories.
  const work = mkdtempSync(resolve(parent, "build-"));
  return {
    work,
    source: resolve(work, "source"),
    stage: resolve(work, "package"),
  };
};

const checkoutPinnedUpstream = ({ work, source }: Build) => {
  run("git", ["clone", "--no-checkout", upstream.url, source], work);
  run("git", ["checkout", "--detach", upstream.tag], source);
  assert.equal(
    text(resolve(source, ".git/HEAD")).trim(),
    upstream.commit,
    "upstream tag does not resolve to pinned commit",
  );
};

const applySourcePatches = ({ source }: Build) => {
  for (const patch of [
    "input-transform.patch",
    "wheel-magnitude.patch",
    "osc8-underline.patch",
  ]) {
    const path = resolve(root, "patches", patch);
    run("git", ["apply", "--check", path], source);
    run("git", ["apply", path], source);
  }
};

const installBuildDependencies = ({ source }: Build) => {
  run(
    "npm",
    [
      "exec",
      "--yes",
      "--package=npm@10.9.4",
      "--",
      "npm",
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    source,
  );
  run("npm", ["rebuild", "esbuild", "node-pty"], source);
};

const compileUpstream = ({ source }: Build) => {
  run("npm", ["run", "build"], source);
  run("npm", ["run", "package"], source);
};

const externalDeclarations = (source: string) => {
  const declaration = text(resolve(source, "typings/xterm.d.ts"));
  const marker = "declare module '@xterm/xterm' {\n";
  assert.ok(
    declaration.includes(marker) && declaration.endsWith("}\n"),
    "unexpected upstream declaration wrapper",
  );
  return declaration
    .replace(marker, "")
    .slice(0, -2)
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n");
};

const sourceFiles = (source: string) =>
  runOutput("git", ["ls-files", "src"], source)
    .trim()
    .split("\n")
    .filter(
      (path) =>
        path &&
        !basename(path).startsWith(".") &&
        !/(^|\/)tsconfig[^/]*\.json$|(^|\/)(test|tests|fixtures)(\/|$)|\.test\.[^.]+$/.test(
          path,
        ),
    );

const assembleNpmPackage = ({ source, stage }: Build) => {
  mkdirSync(stage);
  for (const path of ["lib", "css", "LICENSE"]) {
    cpSync(resolve(source, path), resolve(stage, path), { recursive: true });
  }
  for (const path of sourceFiles(source)) {
    const destination = resolve(stage, path);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    cpSync(resolve(source, path), destination);
  }
  for (const file of ["README.md", "FORK.md", "CHANGELOG.md"]) {
    cpSync(resolve(root, file), resolve(stage, file));
  }
  cpSync(resolve(root, "docs"), resolve(stage, "docs"), { recursive: true });
  mkdirSync(resolve(stage, "typings"));
  writeFileSync(
    resolve(stage, "typings/xterm.d.ts"),
    externalDeclarations(source),
  );
  const manifest = createPublishedManifest(
    JSON.parse(text(resolve(root, "package.json"))),
  );
  writeFileSync(
    resolve(stage, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
};

const buildPackage = () => {
  const workspace = createBuildWorkspace();
  checkoutPinnedUpstream(workspace);
  applySourcePatches(workspace);
  installBuildDependencies(workspace);
  compileUpstream(workspace);
  assembleNpmPackage(workspace);
  return workspace;
};

const packPackage = ({ stage }: Build) => {
  const destination = resolve(root, ".test-tmp");
  mkdirSync(destination, { recursive: true });
  const tarball = resolve(destination, artifactName);
  rmSync(tarball, { force: true });
  run("npm", ["pack", "--json", "--pack-destination", destination], stage);
  assert.ok(existsSync(tarball), `missing expected tarball: ${tarball}`);
  return tarball;
};

const runCommand = () => {
  // Remove old outputs before any fallible work. Consumers must never silently use a stale fork.
  const output = resolve(root, "dist");
  rmSync(output, { recursive: true, force: true });
  rmSync(resolve(root, ".test-tmp", artifactName), { force: true });
  try {
    validateVersionBase(packageVersion, upstream.tag);
    const build = buildPackage();
    const tarball = packPackage(build);
    if (command !== "pack") {
      verifyPackage(build, tarball);
    }
    cpSync(build.stage, output, { recursive: true });
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    rmSync(resolve(root, ".test-tmp", artifactName), { force: true });
    throw error;
  }
};

runCommand();
