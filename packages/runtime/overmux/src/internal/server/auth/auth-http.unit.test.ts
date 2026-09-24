import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthConfigDefinition } from "../../../public/config";
import { createHttpApp } from "../http/create-http-app";
import { createAuthService } from "./auth-service";
import { createAuthBoundary } from "./auth-http";

const directories: string[] = [];

const createApp = async (
  sessionLifetime?: AuthConfigDefinition["sessionLifetime"],
  options: { origins?: string[]; trustedProxyPeer?: string } = {},
) => {
  const dataHome = await mkdtemp(join(tmpdir(), "overmux-auth-http-"));
  directories.push(dataHome);
  const origin = "https://overmux.example.com";
  const authAssetsDirectory = join(dataHome, "auth-assets");
  await Promise.all([
    mkdir(join(authAssetsDirectory, ".vite"), { recursive: true }),
    mkdir(join(authAssetsDirectory, "assets"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(authAssetsDirectory, ".vite", "manifest.json"),
      JSON.stringify({
        "index.html": {
          css: ["assets/entry-abcdefgh.css"],
          file: "assets/entry-abcdefgh.js",
        },
      }),
    ),
    writeFile(
      join(authAssetsDirectory, "index.html"),
      '<!doctype html><html><head><link rel="stylesheet" href="/_overmux/auth-shell/assets/entry-abcdefgh.css"></head><body><div id="root"></div><script type="module" src="/_overmux/auth-shell/assets/entry-abcdefgh.js"></script></body></html>',
    ),
    writeFile(
      join(authAssetsDirectory, "assets", "entry-abcdefgh.css"),
      "body {}",
    ),
    writeFile(
      join(authAssetsDirectory, "assets", "entry-abcdefgh.js"),
      "export {};",
    ),
  ]);
  const auth = createAuthService({
    config: {
      mode: "cli-login",
      ...(sessionLifetime ? { sessionLifetime } : {}),
    },
    environment: { XDG_DATA_HOME: dataHome },
    homeDirectory: "/unused",
  });
  const origins = options.origins ?? [origin];
  auth.setOrigins(origins);
  const authBoundary = createAuthBoundary({
    origins: () => origins,
    service: auth,
    trustedProxyPeer: options.trustedProxyPeer,
  });
  const runtime = {
    getOperation: vi.fn(),
    manifest: { debug: false, operations: [], resources: [], streams: [] },
  };
  const app = createHttpApp({
    auth: authBoundary,
    authAssetsDirectory,
    runtime: runtime as never,
  });
  return { auth, app, origin };
};

const loginHeaders = (origin: string) => ({
  "Content-Type": "application/json",
  Origin: origin,
  "Sec-Fetch-Site": "same-origin",
});

const trustedProxyEnvironment = {
  incoming: { socket: { remoteAddress: "127.0.0.1" } },
} as never;

const proxiedHeaders = (origin: string, headers: HeadersInit = {}) => ({
  ...Object.fromEntries(new Headers(headers)),
  "X-Forwarded-Host": new URL(origin).host,
  "X-Forwarded-Proto": "https",
});

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("HTTP authentication boundary", () => {
  it("serves only the owned shell and public state before login", async () => {
    const { app, origin } = await createApp();

    const shell = await app.request(`${origin}/`, {
      headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
    });
    const nestedNavigation = await app.request(`${origin}/workspace`, {
      headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
    });
    const state = await app.request(`${origin}/api/auth/state`);
    const health = await app.request(`${origin}/api/health`);
    const authAsset = await app.request(
      `${origin}/_overmux/auth-shell/assets/entry-abcdefgh.js`,
    );
    const authManifest = await app.request(
      `${origin}/_overmux/auth-shell/.vite/manifest.json`,
    );
    const runtimeManifest = await app.request(
      `${origin}/api/runtime-manifest`,
      {
        headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
      },
    );
    const userAsset = await app.request(`${origin}/src/app.tsx`);

    expect(shell.status).toBe(401);
    expect(shell.headers.get("cache-control")).toBe("no-store");
    expect(shell.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    const shellHtml = await shell.text();
    expect(shellHtml).toContain('<div id="root"></div>');
    expect(shellHtml).toContain(
      'src="/_overmux/auth-shell/assets/entry-abcdefgh.js"',
    );
    expect(shellHtml).toContain(
      'href="/_overmux/auth-shell/assets/entry-abcdefgh.css"',
    );
    expect(nestedNavigation.status).toBe(401);
    expect(await nestedNavigation.text()).toContain('<div id="root"></div>');
    await expect(state.json()).resolves.toEqual({ authenticated: false });
    expect(health.status).toBe(200);
    expect(authAsset.status).toBe(200);
    expect(authAsset.headers.get("cache-control")).toContain("immutable");
    expect(authManifest.status).toBe(404);
    expect(runtimeManifest.status).toBe(401);
    expect(userAsset.status).toBe(401);
    await expect(runtimeManifest.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  it("fails closed when protected request authentication is unavailable", async () => {
    const { auth, app, origin } = await createApp();
    vi.spyOn(auth, "authenticateToken").mockRejectedValue(
      new Error("store unavailable"),
    );

    const response = await app.request(`${origin}/api/runtime-manifest`, {
      headers: { Cookie: "__Host-overmux_session=token" },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Authentication service unavailable",
    });
  });

  it("enforces browser request metadata and issues a secure host-only cookie", async () => {
    const { auth, app, origin } = await createApp();
    const login = await auth.createLoginGrant();

    const rejected = await app.request(`${origin}/api/auth/login`, {
      body: JSON.stringify({ code: login.code }),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      method: "POST",
    });
    const accepted = await app.request(`${origin}/api/auth/login`, {
      body: JSON.stringify({ code: login.code }),
      headers: loginHeaders(origin),
      method: "POST",
    });

    expect(rejected.status).toBe(403);
    expect(accepted.status).toBe(200);
    const cookie = accepted.headers.get("Set-Cookie")!;
    expect(cookie).toContain("__Host-overmux_session=");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Domain=");

    const browserCookie = cookie.split(";", 1)[0]!;
    const manifest = await app.request(`${origin}/api/runtime-manifest`, {
      headers: { Cookie: browserCookie },
    });
    const rejectedMutation = await app.request(`${origin}/api/restart`, {
      headers: { Cookie: browserCookie },
      method: "POST",
    });
    const acceptedMutation = await app.request(`${origin}/api/restart`, {
      headers: { ...loginHeaders(origin), Cookie: browserCookie },
      method: "POST",
    });

    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-security-policy")).toBeNull();
    expect(rejectedMutation.status).toBe(403);
    expect(acceptedMutation.status).toBe(202);

    const logout = await app.request(`${origin}/api/auth/logout`, {
      headers: { ...loginHeaders(origin), Cookie: browserCookie },
      method: "POST",
    });
    const afterLogout = await app.request(`${origin}/api/runtime-manifest`, {
      headers: { Cookie: browserCookie },
    });
    expect(logout.status).toBe(200);
    const clearedCookie = logout.headers.get("set-cookie")!;
    expect(clearedCookie).toContain("__Host-overmux_session=;");
    expect(clearedCookie).toContain("Max-Age=0");
    expect(clearedCookie).toContain("Path=/");
    expect(clearedCookie).toContain("HttpOnly");
    expect(clearedCookie).toContain("SameSite=Strict");
    expect(clearedCookie).toContain("Secure");
    expect(clearedCookie).not.toContain("Domain=");
    expect(afterLogout.status).toBe(401);
  });

  it("selects independent cookies and request policy for direct and trusted-proxy origins", async () => {
    const localOrigin = "http://localhost:4242";
    const proxyOrigin = "https://machine.example.com";
    const { auth, app } = await createApp(undefined, {
      origins: [localOrigin, proxyOrigin],
      trustedProxyPeer: "127.0.0.1",
    });
    const localGrant = await auth.createLoginGrant();
    const localLogin = await app.request(`${localOrigin}/api/auth/login`, {
      body: JSON.stringify({ code: localGrant.code }),
      headers: loginHeaders(localOrigin),
      method: "POST",
    });
    const localCookie = localLogin.headers.get("set-cookie")!;
    const localToken = localCookie.split(";", 1)[0]!.split("=", 2)[1]!;
    const proxyGrant = await auth.createLoginGrant();
    const proxyTarget = `http://${new URL(proxyOrigin).host}`;
    const spoofedLogin = await app.request(
      `${proxyTarget}/api/auth/login`,
      {
        body: JSON.stringify({ code: proxyGrant.code }),
        headers: proxiedHeaders(proxyOrigin, loginHeaders(proxyOrigin)),
        method: "POST",
      },
      { incoming: { socket: { remoteAddress: "10.0.0.1" } } } as never,
    );
    const proxyLogin = await app.request(
      `${proxyTarget}/api/auth/login`,
      {
        body: JSON.stringify({ code: proxyGrant.code }),
        headers: proxiedHeaders(proxyOrigin, loginHeaders(proxyOrigin)),
        method: "POST",
      },
      trustedProxyEnvironment,
    );
    const proxySetCookie = proxyLogin.headers.get("set-cookie")!;
    const proxyCookie = proxySetCookie.split(";", 1)[0]!;
    const proxyState = await app.request(
      `${proxyTarget}/api/auth/state`,
      { headers: proxiedHeaders(proxyOrigin, { Cookie: proxyCookie }) },
      trustedProxyEnvironment,
    );
    const rejectedCopiedToken = await app.request(
      `${proxyTarget}/api/runtime-manifest`,
      {
        headers: proxiedHeaders(proxyOrigin, {
          Cookie: `__Host-overmux_session=${localToken}`,
        }),
      },
      trustedProxyEnvironment,
    );
    const proxyMutation = await app.request(
      `${proxyTarget}/api/restart`,
      {
        headers: proxiedHeaders(proxyOrigin, {
          ...loginHeaders(proxyOrigin),
          Cookie: proxyCookie,
        }),
        method: "POST",
      },
      trustedProxyEnvironment,
    );

    expect(localLogin.status).toBe(200);
    expect(localCookie).toContain("overmux_session=");
    expect(localCookie).toContain("Path=/");
    expect(localCookie).not.toContain("Secure");
    expect(spoofedLogin.status).toBe(403);
    expect(proxyLogin.status).toBe(200);
    expect(proxySetCookie).toContain("__Host-overmux_session=");
    expect(proxySetCookie).toContain("Secure");
    await expect(proxyState.json()).resolves.toEqual({ authenticated: true });
    expect(rejectedCopiedToken.status).toBe(401);
    expect(proxyMutation.status).toBe(202);
    expect(
      (await auth.listSessions()).map((session) => session.origin),
    ).toEqual([localOrigin, proxyOrigin]);
  });

  it("caps the cookie lifetime without shortening a longer configured session", async () => {
    const { auth, app, origin } = await createApp("401d");
    const login = await auth.createLoginGrant();
    const beforeLogin = Date.now();

    const response = await app.request(`${origin}/api/auth/login`, {
      body: JSON.stringify({ code: login.code }),
      headers: loginHeaders(origin),
      method: "POST",
    });
    const sessions = await auth.listSessions();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=34560000");
    expect(Date.parse(sessions[0]!.expiresAt!)).toBeGreaterThan(
      beforeLogin + 400 * 24 * 60 * 60 * 1_000,
    );
  });

  it("rejects login bodies above the streaming limit", async () => {
    const { app, origin } = await createApp();

    const response = await app.request(`${origin}/api/auth/login`, {
      body: JSON.stringify({ code: "A".repeat(4_096) }),
      headers: loginHeaders(origin),
      method: "POST",
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Login request is too large",
    });
  });

  it("rejects untrusted metadata and malformed or excessive login requests", async () => {
    const { app, origin } = await createApp();
    const untrusted = await app.request(`${origin}/api/auth/login`, {
      body: JSON.stringify({ code: "AAAA-BBBB" }),
      headers: { "Content-Type": "application/json", Origin: origin },
      method: "POST",
    });
    const malformed = await app.request(`${origin}/api/auth/login`, {
      body: JSON.stringify({ code: "AAAA-BBBB", extra: true }),
      headers: loginHeaders(origin),
      method: "POST",
    });
    const attempts = await Promise.all(
      Array.from({ length: 11 }, () =>
        app.request(`${origin}/api/auth/login`, {
          body: JSON.stringify({ code: "AAAA-BBBB" }),
          headers: loginHeaders(origin),
          method: "POST",
        }),
      ),
    );
    const limited = await app.request(`${origin}/api/auth/login`, {
      body: JSON.stringify({ code: "AAAA-BBBB" }),
      headers: loginHeaders(origin),
      method: "POST",
    });

    expect(untrusted.status).toBe(403);
    expect(malformed.status).toBe(400);
    expect(attempts.map((response) => response.status)).toEqual(
      Array.from({ length: 11 }, () => 401),
    );
    expect(limited.status).toBe(429);
  });

  it("keeps browser cookies and local bearer credentials separate", async () => {
    const { auth, app, origin } = await createApp();
    const login = await auth.createLoginGrant();
    const browser = await auth.consumeLoginGrant({ code: login.code, origin });
    if (browser.status !== "authenticated") {
      throw new Error("Expected an authenticated browser session");
    }
    const bearer = await auth.issueLocalBearer();

    const bearerResponse = await app.request(`${origin}/api/runtime-manifest`, {
      headers: { Authorization: `Bearer ${bearer.token}` },
    });
    const bearerAsCookie = await app.request(`${origin}/api/runtime-manifest`, {
      headers: { Cookie: `__Host-overmux_session=${bearer.token}` },
    });
    const browserAsBearer = await app.request(
      `${origin}/api/runtime-manifest`,
      { headers: { Authorization: `Bearer ${browser.token}` } },
    );

    expect(bearerResponse.status).toBe(200);
    expect(bearerAsCookie.status).toBe(401);
    expect(browserAsBearer.status).toBe(401);
  });
});
