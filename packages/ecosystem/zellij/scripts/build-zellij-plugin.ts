// Builds the pinned Zellij plugin twice and compares byte-for-byte output.
// The verified artifact and manifest become the publish inputs for @overmux/zellij.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const packageDirectory = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageDirectory, "../../..");
const pluginDirectory = resolve(packageDirectory, "plugin");
const scratchRoot = resolve(repositoryRoot, ".test-tmp/zellij-plugin-build");
const target = "wasm32-wasip1";
const relativeWasm = `${target}/release/overmux.wasm`;
const checkOnly = process.argv.includes("--check");
const cargoHome = resolve(
  process.env.CARGO_HOME ?? resolve(homedir(), ".cargo"),
);
const rustFlags = [
  `--remap-path-prefix=${repositoryRoot}=/workspace`,
  `--remap-path-prefix=${cargoHome}=/cargo`,
].join("\u001f");

const sha256 = (contents: Uint8Array) =>
  createHash("sha256").update(contents).digest("hex");

const build = async (name: string) => {
  const targetDirectory = resolve(scratchRoot, name);
  await rm(targetDirectory, { force: true, recursive: true });
  execFileSync(
    "cargo",
    ["build", "--locked", "--release", "--target", target],
    {
      cwd: pluginDirectory,
      env: {
        ...process.env,
        CARGO_ENCODED_RUSTFLAGS: rustFlags,
        CARGO_INCREMENTAL: "0",
        CARGO_TARGET_DIR: targetDirectory,
        SOURCE_DATE_EPOCH: "0",
      },
      stdio: "inherit",
    },
  );
  return readFile(resolve(targetDirectory, relativeWasm));
};

const readPluginVersion = async () => {
  const cargoToml = await readFile(
    resolve(pluginDirectory, "Cargo.toml"),
    "utf8",
  );
  const version = /^version = "([^"]+)"$/mu.exec(cargoToml)?.[1];
  if (version === undefined) {
    throw new Error("Cargo.toml has no package version");
  }
  return version;
};

const assertProtocolVersion = async () => {
  const sources = await Promise.all([
    readFile(resolve(pluginDirectory, "src/protocol.rs"), "utf8"),
    readFile(
      resolve(packageDirectory, "src/shared/plugin-protocol.ts"),
      "utf8",
    ),
  ]);
  const versions = [
    /PROTOCOL_VERSION: u8 = (\d+)/u.exec(sources[0])?.[1],
    /ZELLIJ_PROTOCOL_VERSION = (\d+)/u.exec(sources[1])?.[1],
  ];
  if (versions[0] === undefined || versions[0] !== versions[1]) {
    throw new Error(
      `Rust and TypeScript protocol versions differ: ${versions}`,
    );
  }
  return Number(versions[0]);
};

const main = async () => {
  const [first, second] = await Promise.all([build("first"), build("second")]);
  if (!first.equals(second)) {
    throw new Error("Zellij plugin builds are not reproducible");
  }

  const manifest = {
    pluginVersion: await readPluginVersion(),
    protocolVersion: await assertProtocolVersion(),
    sha256: sha256(first),
    supportedZellijVersion: "0.45.1",
  };
  const manifestContents = `${JSON.stringify(manifest, undefined, 2)}\n`;
  const artifactPath = resolve(packageDirectory, "overmux.wasm");
  const manifestPath = resolve(packageDirectory, "overmux-plugin.json");

  if (checkOnly) {
    const [committedArtifact, committedManifest] = await Promise.all([
      readFile(artifactPath),
      readFile(manifestPath, "utf8"),
    ]);
    if (
      !first.equals(committedArtifact) ||
      manifestContents !== committedManifest
    ) {
      throw new Error(
        "Committed Zellij plugin artifacts differ; run pnpm --filter @overmux/zellij build-plugin",
      );
    }
  } else {
    await Promise.all([
      writeFile(artifactPath, first),
      writeFile(manifestPath, manifestContents),
    ]);
  }
  console.log(`Verified reproducible overmux.wasm (${manifest.sha256})`);
};

try {
  await main();
} finally {
  await rm(scratchRoot, { force: true, recursive: true });
}
