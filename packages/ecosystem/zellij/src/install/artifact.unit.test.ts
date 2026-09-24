import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { getInstalledArtifactPath, installArtifact } from "./artifact";

const packageDirectory = resolve(import.meta.dirname, "../..");
const scratchRoot = resolve(packageDirectory, "../../..", ".test-tmp");

const writeSourceArtifact = async (directory: string, contents: Buffer) => {
  const artifactPath = resolve(directory, "source.wasm");
  const manifestPath = resolve(directory, "manifest.json");
  const sha256 = createHash("sha256").update(contents).digest("hex");
  await Promise.all([
    writeFile(artifactPath, contents),
    writeFile(
      manifestPath,
      JSON.stringify({
        pluginVersion: "0.0.1",
        protocolVersion: 1,
        sha256,
        supportedZellijVersion: "0.45.1",
      }),
    ),
  ]);
  return { artifactPath, manifestPath, sha256 };
};

describe("Zellij plugin artifact", () => {
  beforeEach(() => mkdir(scratchRoot, { recursive: true }));

  it("atomically installs and deliberately replaces the stable artifact", async () => {
    const directory = await mkdtemp(resolve(scratchRoot, "zellij-artifact-"));
    const destination = resolve(directory, "xdg/overmux.wasm");
    const source = await writeSourceArtifact(directory, Buffer.from("first"));

    const first = await installArtifact({ ...source, destination });
    const second = await installArtifact({ ...source, destination });

    expect(first).toMatchObject({ replaced: false, sha256: source.sha256 });
    expect(second.replaced).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("first");
  });

  it("rejects a bundled artifact whose manifest checksum is stale", async () => {
    const directory = await mkdtemp(resolve(scratchRoot, "zellij-artifact-"));
    const source = await writeSourceArtifact(directory, Buffer.from("first"));
    await writeFile(source.artifactPath, "corrupted");

    await expect(
      installArtifact({
        ...source,
        destination: resolve(directory, "installed"),
      }),
    ).rejects.toThrow("checksum does not match");
  });

  it("rejects a relative XDG data directory", () => {
    expect(() =>
      getInstalledArtifactPath({
        env: { XDG_DATA_HOME: "relative/data" },
        home: "/home/tester",
      }),
    ).toThrow(
      'XDG_DATA_HOME must be an absolute path; received "relative/data". Set it to an absolute path or unset it.',
    );
  });

  it("reads the bundled artifact from the packed runtime", async () => {
    const directory = await mkdtemp(resolve(scratchRoot, "zellij-package-"));
    const extractedDirectory = resolve(directory, "extracted");
    execFileSync("pnpm", ["run", "build"], { cwd: packageDirectory });
    execFileSync("pnpm", ["pack", "--pack-destination", directory], {
      cwd: packageDirectory,
    });
    const tarballName = (await readdir(directory)).find((name) =>
      name.endsWith(".tgz"),
    );
    if (!tarballName) {
      throw new Error("pnpm pack did not create a tarball");
    }
    await mkdir(extractedDirectory);
    execFileSync(
      "tar",
      ["-xzf", resolve(directory, tarballName), "-C", extractedDirectory],
      { cwd: packageDirectory },
    );

    const moduleUrl = pathToFileURL(
      resolve(extractedDirectory, "package/dist/install/artifact.js"),
    );
    const packedModule = (await import(moduleUrl.href)) as {
      readBundledArtifact: () => Promise<{
        artifact: Buffer;
        manifest: { sha256: string };
      }>;
    };
    const { artifact, manifest } = await packedModule.readBundledArtifact();

    expect(createHash("sha256").update(artifact).digest("hex")).toBe(
      manifest.sha256,
    );
  }, 30_000);

  it("includes the WASM and manifest in the package dry run", () => {
    const output = execFileSync("pnpm", ["pack", "--dry-run", "--json"], {
      cwd: packageDirectory,
      encoding: "utf8",
    });

    expect(output).toContain('"overmux.wasm"');
    expect(output).toContain('"overmux-plugin.json"');
  });
});
