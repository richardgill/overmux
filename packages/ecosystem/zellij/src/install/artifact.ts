// The installer validates the bundled WASM before and after an atomic XDG copy.
// This keeps partial writes and corrupted package artifacts out of the stable path.
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { ZELLIJ_PROTOCOL_VERSION } from "../shared/plugin-protocol";
import {
  ZellijArtifactMissingError,
  ZellijArtifactVerificationError,
} from "./errors";

const manifestSchema = z.object({
  pluginVersion: z.string().min(1),
  protocolVersion: z.literal(ZELLIJ_PROTOCOL_VERSION),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  supportedZellijVersion: z.literal("0.45.1"),
});

export type ZellijPluginManifest = z.infer<typeof manifestSchema>;

export type InstalledArtifact = ZellijPluginManifest & {
  artifactPath: string;
  replaced: boolean;
};

const installEntryUrl = import.meta.resolve("@overmux/zellij/install");
const packageRoot = fileURLToPath(new URL("../../", installEntryUrl));

export const bundledArtifactPath = join(packageRoot, "overmux.wasm");
export const bundledManifestPath = join(packageRoot, "overmux-plugin.json");

export const getInstalledArtifactPath = ({
  env = process.env,
  home = homedir(),
}: {
  env?: NodeJS.ProcessEnv;
  home?: string;
} = {}) => {
  const configuredDataHome = env.XDG_DATA_HOME;
  if (configuredDataHome && !isAbsolute(configuredDataHome)) {
    throw new Error(
      `XDG_DATA_HOME must be an absolute path; received "${configuredDataHome}". Set it to an absolute path or unset it.`,
    );
  }
  const dataHome = configuredDataHome || join(home, ".local", "share");
  return join(dataHome, "overmux", "zellij", "overmux.wasm");
};

const sha256 = (contents: Uint8Array) =>
  createHash("sha256").update(contents).digest("hex");

const exists = async (path: string) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export const readBundledArtifact = async ({
  artifactPath = bundledArtifactPath,
  manifestPath = bundledManifestPath,
}: {
  artifactPath?: string;
  manifestPath?: string;
} = {}) => {
  let artifact: Buffer;
  let manifestContents: string;
  try {
    [artifact, manifestContents] = await Promise.all([
      readFile(artifactPath),
      readFile(manifestPath, "utf8"),
    ]);
  } catch (error) {
    throw new ZellijArtifactMissingError(
      `@overmux/zellij does not contain its bundled plugin artifact: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let manifest: ZellijPluginManifest;
  try {
    manifest = manifestSchema.parse(JSON.parse(manifestContents) as unknown);
  } catch (error) {
    throw new ZellijArtifactVerificationError(
      `The bundled Zellij plugin manifest is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (sha256(artifact) !== manifest.sha256) {
    throw new ZellijArtifactVerificationError(
      "The bundled Zellij plugin checksum does not match overmux-plugin.json",
    );
  }
  return { artifact, manifest };
};

export const verifyInstalledArtifact = async ({
  destination = getInstalledArtifactPath(),
}: {
  destination?: string;
} = {}) => {
  const { manifest } = await readBundledArtifact();
  let installed: Buffer;
  try {
    installed = await readFile(destination);
  } catch (error) {
    throw new ZellijArtifactMissingError(
      `The Zellij plugin is not installed at ${destination}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (sha256(installed) !== manifest.sha256) {
    throw new ZellijArtifactVerificationError(
      `The installed Zellij plugin does not match this package at ${destination}`,
    );
  }
  return { artifactPath: destination, ...manifest };
};

export const installArtifact = async ({
  artifactPath = bundledArtifactPath,
  destination = getInstalledArtifactPath(),
  manifestPath = bundledManifestPath,
}: {
  artifactPath?: string;
  destination?: string;
  manifestPath?: string;
} = {}): Promise<InstalledArtifact> => {
  const { artifact, manifest } = await readBundledArtifact({
    artifactPath,
    manifestPath,
  });
  const replaced = await exists(destination);
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  await mkdir(dirname(destination), { recursive: true });

  try {
    await writeFile(temporaryPath, artifact, { mode: 0o644 });
    await chmod(temporaryPath, 0o644);
    await rename(temporaryPath, destination);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  const installedSha256 = sha256(await readFile(destination));
  if (installedSha256 !== manifest.sha256) {
    throw new ZellijArtifactVerificationError(
      `Installed Zellij plugin checksum mismatch at ${destination}`,
    );
  }
  return { artifactPath: destination, replaced, ...manifest };
};
