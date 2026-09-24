import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export type DesktopArchitecture = "arm64" | "x64";

type GitHubAsset = {
  browser_download_url: string;
  name: string;
  size: number;
};

type GitHubRelease = {
  assets: GitHubAsset[];
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  tag_name: string;
};

export type DesktopRelease = {
  artifact: GitHubAsset;
  checksums: GitHubAsset;
  tag: string;
  version: string;
};

const releasesUrl =
  "https://api.github.com/repos/richardgill/overmux/releases?per_page=100";
const downloadRoot =
  "https://github.com/richardgill/overmux/releases/download/";

export const getMacDesktopArtifactName = (
  version: string,
  architecture: DesktopArchitecture,
) => `Overmux-Desktop-${version}-mac-${architecture}.zip`;

const assertOfficialAsset = (asset: GitHubAsset, tag: string) => {
  const expected = `${downloadRoot}${tag}/${asset.name}`;
  if (asset.browser_download_url !== expected) {
    throw new Error(
      `Refusing unofficial desktop asset URL: ${asset.browser_download_url}`,
    );
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`Desktop release asset ${asset.name} has an invalid size`);
  }
};

export const selectDesktopRelease = (
  releases: readonly GitHubRelease[],
  architecture: DesktopArchitecture,
): DesktopRelease => {
  const candidates = releases
    .filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        /^desktop-v[^/]+$/.test(release.tag_name),
    )
    .sort((left, right) =>
      (right.published_at ?? "").localeCompare(left.published_at ?? ""),
    );

  const selected = candidates.find((release) => {
    const version = release.tag_name.slice("desktop-v".length);
    return release.assets.some(
      (asset) =>
        asset.name === getMacDesktopArtifactName(version, architecture),
    );
  });
  if (!selected) {
    throw new Error(
      `No stable Overmux Desktop release supports macOS ${architecture}`,
    );
  }

  const version = selected.tag_name.slice("desktop-v".length);
  const artifactName = getMacDesktopArtifactName(version, architecture);
  const artifact = selected.assets.find((asset) => asset.name === artifactName);
  const checksums = selected.assets.find(
    (asset) => asset.name === "SHA256SUMS",
  );
  if (!artifact || !checksums) {
    throw new Error(`Desktop release ${selected.tag_name} is incomplete`);
  }
  assertOfficialAsset(artifact, selected.tag_name);
  assertOfficialAsset(checksums, selected.tag_name);
  return { artifact, checksums, tag: selected.tag_name, version };
};

const fetchOk = async (url: string, fetch: typeof globalThis.fetch) => {
  if (new URL(url).protocol !== "https:") {
    throw new Error(`Refusing insecure desktop release URL: ${url}`);
  }
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}) for ${url}`);
  }
  if (response.url && new URL(response.url).protocol !== "https:") {
    throw new Error(
      `Refusing insecure desktop release redirect: ${response.url}`,
    );
  }
  return response;
};

export const findDesktopRelease = async (
  architecture: DesktopArchitecture,
  fetch = globalThis.fetch,
) => {
  const response = await fetchOk(releasesUrl, fetch);
  return selectDesktopRelease(
    (await response.json()) as GitHubRelease[],
    architecture,
  );
};

export const parseSha256Sums = (contents: string) => {
  const checksums = new Map<string, string>();
  contents.split(/\r?\n/).forEach((line) => {
    if (!line) {
      return;
    }
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    if (!match || checksums.has(match[2])) {
      throw new Error("Desktop release has an invalid SHA256SUMS file");
    }
    checksums.set(match[2], match[1]);
  });
  return checksums;
};

export const downloadTextAsset = async (
  asset: GitHubAsset,
  fetch = globalThis.fetch,
) => {
  const response = await fetchOk(asset.browser_download_url, fetch);
  const contents = await response.text();
  if (Buffer.byteLength(contents) !== asset.size) {
    throw new Error(
      `Downloaded ${asset.name} size does not match GitHub metadata`,
    );
  }
  return contents;
};

export const downloadVerifiedAsset = async ({
  asset,
  destination,
  expectedSha256,
  fetch = globalThis.fetch,
}: {
  asset: GitHubAsset;
  destination: string;
  expectedSha256: string;
  fetch?: typeof globalThis.fetch;
}) => {
  const response = await fetchOk(asset.browser_download_url, fetch);
  if (!response.body) {
    throw new Error(`Downloaded ${asset.name} has no body`);
  }
  const hash = createHash("sha256");
  let size = 0;
  const verification = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(
      response.body as unknown as import("node:stream/web").ReadableStream,
    ),
    verification,
    createWriteStream(destination),
  );
  if (size !== asset.size) {
    throw new Error(
      `Downloaded ${asset.name} size does not match GitHub metadata`,
    );
  }
  if (hash.digest("hex") !== expectedSha256) {
    throw new Error(`Downloaded ${asset.name} failed SHA-256 verification`);
  }
};
