import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Context } from "hono";

const authAssetPrefix = "/_overmux/auth-shell/";
const authEntry = "index.html";
const fingerprintedAssetPattern =
  /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:css|js)$/;

type AuthManifest = Record<string, { css?: string[]; file?: string }>;
type AuthAsset = { body: ArrayBuffer; contentType: string };

export type AuthShell = {
  files: Map<string, AuthAsset>;
  html: string;
};

const defaultAuthAssetsDirectory = () =>
  fileURLToPath(new URL("../auth/", import.meta.resolve("overmux")));

export const loadAuthShell = (
  directory = defaultAuthAssetsDirectory(),
): AuthShell => {
  const manifest = JSON.parse(
    readFileSync(`${directory}/.vite/manifest.json`, "utf8"),
  ) as AuthManifest;
  const entry = manifest[authEntry];
  if (!entry?.file || !entry.css?.length) {
    throw new Error(
      "The packaged Overmux authentication assets are incomplete",
    );
  }
  const paths = new Set(
    Object.values(manifest).flatMap(({ css = [], file }) =>
      file ? [file, ...css] : css,
    ),
  );
  const invalidPath = [...paths].find(
    (path) => !fingerprintedAssetPattern.test(path),
  );
  if (invalidPath) {
    throw new Error(
      `Invalid Overmux authentication asset path: ${invalidPath}`,
    );
  }
  const files = new Map(
    [...paths].map((path) => [
      path,
      {
        body: Uint8Array.from(readFileSync(`${directory}/${path}`)).buffer,
        contentType: path.endsWith(".css")
          ? "text/css; charset=UTF-8"
          : "text/javascript; charset=UTF-8",
      },
    ]),
  );
  return { files, html: readFileSync(`${directory}/index.html`, "utf8") };
};

export const serveAuthShellAsset = (context: Context, shell: AuthShell) => {
  const asset = shell.files.get(context.req.path.slice(authAssetPrefix.length));
  if (!asset) {
    return context.body(null, 404);
  }
  context.header("Cache-Control", "public, max-age=31536000, immutable");
  context.header("Content-Type", asset.contentType);
  context.header("Cross-Origin-Resource-Policy", "same-origin");
  context.header("X-Content-Type-Options", "nosniff");
  return context.body(asset.body);
};

export const renderAuthShell = (
  context: Context,
  shell: AuthShell,
  status: 200 | 401 = 200,
) => {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  context.header("Cross-Origin-Resource-Policy", "same-origin");
  context.header("Referrer-Policy", "no-referrer");
  context.header("X-Content-Type-Options", "nosniff");
  return context.html(shell.html, status);
};

export const isBrowserNavigation = (request: Request) =>
  request.headers.get("Sec-Fetch-Dest") === "document" ||
  request.headers.get("Accept")?.includes("text/html");
