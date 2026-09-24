import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  downloadVerifiedAsset,
  type DesktopArchitecture,
  getMacDesktopArtifactName,
  parseSha256Sums,
  selectDesktopRelease,
} from "./desktop-release";

const testDirectory = resolve(
  import.meta.dirname,
  "../../../../../../../.test-tmp/desktop-release-client",
);

const asset = (tag: string, name: string, size = 10) => ({
  browser_download_url: `https://github.com/richardgill/overmux/releases/download/${tag}/${name}`,
  name,
  size,
});

const release = ({
  architecture = "arm64" as DesktopArchitecture,
  draft = false,
  prerelease = false,
  publishedAt = "2026-01-01T00:00:00Z",
  tag = "desktop-v1.2.3",
} = {}) => {
  const version = tag.slice("desktop-v".length);
  return {
    assets: [
      asset(tag, getMacDesktopArtifactName(version, architecture)),
      asset(tag, "SHA256SUMS"),
    ],
    draft,
    prerelease,
    published_at: publishedAt,
    tag_name: tag,
  };
};

describe("desktop release selection", () => {
  it("selects the newest stable release supporting the architecture", () => {
    const selected = selectDesktopRelease(
      [
        release({ tag: "desktop-v1.0.0", publishedAt: "2025-01-01T00:00:00Z" }),
        release({ tag: "desktop-v3.0.0", prerelease: true }),
        release({ tag: "desktop-v2.0.0", architecture: "x64" }),
        release({ tag: "desktop-v1.1.0", publishedAt: "2025-06-01T00:00:00Z" }),
      ],
      "arm64",
    );

    expect(selected.tag).toBe("desktop-v1.1.0");
    expect(selected.artifact.name).toBe("Overmux-Desktop-1.1.0-mac-arm64.zip");
  });

  it("rejects releases without a complete official asset set", () => {
    const incomplete = release();
    incomplete.assets = incomplete.assets.slice(0, 1);
    expect(() => selectDesktopRelease([incomplete], "arm64")).toThrow(
      "desktop-v1.2.3 is incomplete",
    );

    const unofficial = release();
    unofficial.assets[0].browser_download_url = "https://example.com/app.zip";
    expect(() => selectDesktopRelease([unofficial], "arm64")).toThrow(
      "Refusing unofficial desktop asset URL",
    );
  });
});

describe("desktop release verification", () => {
  beforeEach(() => {
    rmSync(testDirectory, { force: true, recursive: true });
    mkdirSync(testDirectory, { recursive: true });
  });

  it("parses only unambiguous SHA-256 entries", () => {
    const hash = "a".repeat(64);
    expect(parseSha256Sums(`${hash}  app.zip\n`).get("app.zip")).toBe(hash);
    expect(() => parseSha256Sums(`${hash}  ../app.zip\n`)).toThrow(
      "invalid SHA256SUMS",
    );
    expect(() =>
      parseSha256Sums(`${hash}  app.zip\n${hash}  app.zip\n`),
    ).toThrow("invalid SHA256SUMS");
  });

  it("downloads an asset only when its size and SHA-256 match", async () => {
    const contents = Buffer.from("verified archive");
    const expectedSha256 = createHash("sha256").update(contents).digest("hex");
    const destination = resolve(testDirectory, "app.zip");
    const releaseAsset = asset("desktop-v1.2.3", "app.zip", contents.length);
    const fetch = async () => new Response(contents);

    await downloadVerifiedAsset({
      asset: releaseAsset,
      destination,
      expectedSha256,
      fetch,
    });

    expect(readFileSync(destination)).toEqual(contents);
    await expect(
      downloadVerifiedAsset({
        asset: releaseAsset,
        destination,
        expectedSha256: "0".repeat(64),
        fetch,
      }),
    ).rejects.toThrow("failed SHA-256 verification");
  });
});
