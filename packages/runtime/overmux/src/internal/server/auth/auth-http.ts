import type { HttpBindings } from "@hono/node-server";
import type { Context, Handler, MiddlewareHandler } from "hono";
import { generateCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { parse as parseCookie } from "hono/utils/cookie";
import { z } from "zod";

import { createRateLimiter, hasRateLimitCapacity } from "../rate-limiter";
import type { AuthService, AuthenticatedSession } from "./auth-service";
import {
  isBrowserNavigation,
  loadAuthShell,
  renderAuthShell,
  serveAuthShellAsset,
} from "./auth-shell-http";

const maxLoginBodyBytes = 4_096;
// Login limits use a rolling window covering the preceding 60 seconds.
const loginWindowMs = 60_000;
const maxLoginRequestsPerWindow = 12;
const maxGlobalLoginRequestsPerWindow = 120;
const maxTrackedLoginAddresses = 10_000;
// Browser cookies cap non-expiring and longer sessions at 400 days.
const neverCookieLifetimeSeconds = 400 * 24 * 60 * 60;
const sessionCookieName = "overmux_session";

// Session kind records the intended client, while credential records how the
// request presented it. Only local + bearer and browser + cookie are accepted.
// This prevents a copied browser token from bypassing browser origin policy.
export type RequestSession = AuthenticatedSession & {
  credential: "bearer" | "cookie";
};

export type AuthEnvironment = {
  Variables: { session: RequestSession };
};

export type RequestAuthentication = {
  authenticate: (
    request: Request,
    origin?: string,
  ) => Promise<RequestSession | undefined>;
  clearCookieHeader: (origin: string) => string;
  cookieHeader: (origin: string, token: string, expiresAt?: string) => string;
};

export type RequestOriginInput = {
  remoteAddress?: string;
  request: Request;
};

// Groups the transport-neutral session service with the HTTP-specific policy
// needed to authenticate requests against the configured browser origins.
export type AuthBoundary = {
  // Owns login grants, persisted sessions, token validation, and revocation.
  service: AuthService;
  // Resolves lazily because an ephemeral listening port is unknown until startup.
  resolveOrigin: (input: RequestOriginInput) => string | undefined;
  // Parses request credentials and creates or clears browser session cookies.
  requests: RequestAuthentication;
};

const bearerToken = (header: string | null) =>
  /^Bearer ([A-Za-z0-9_-]+)$/.exec(header ?? "")?.[1];

const isLoopbackHostname = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "::1" ||
  hostname === "[::1]" ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname);

export const validateAuthOrigin = (origin: string) => {
  const url = new URL(origin);
  if (url.origin !== origin) {
    throw new Error("auth.origins must contain exact origins without paths");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopbackHostname(url.hostname))
  ) {
    throw new Error("Non-loopback Overmux origins must use HTTPS");
  }
  return origin;
};

// Proxy chains commonly represent multiple previous values as a comma-separated list.
// Authentication accepts only one exact value with no surrounding whitespace.
const exactForwardedValue = (value: string | null) =>
  value !== null && value === value.trim() && !value.includes(",")
    ? value
    : undefined;

// Resolve the browser-facing origin and return it only when explicitly configured.
export const resolveRequestOrigin = ({
  origins,
  remoteAddress,
  request,
  trustedProxyPeer,
}: RequestOriginInput & {
  origins: string[];
  trustedProxyPeer?: string;
}) => {
  const requestUrl = new URL(request.url);

  // A reverse proxy accepts the browser request, then opens a new backend request to Overmux.
  // These headers report the browser-facing host, optional port, and protocol lost on that hop.
  // They are ordinary spoofable headers until the immediate sender matches trustedProxyPeer.
  const forwardedHost = request.headers.get("X-Forwarded-Host");
  const forwardedProto = request.headers.get("X-Forwarded-Proto");

  // If the trusted proxy supplies either header, require a complete valid pair.
  // Invalid proxy metadata rejects the request instead of falling back to its direct origin.
  if (
    trustedProxyPeer !== undefined &&
    remoteAddress === trustedProxyPeer &&
    (forwardedHost !== null || forwardedProto !== null)
  ) {
    const host = exactForwardedValue(forwardedHost);
    const proto = exactForwardedValue(forwardedProto);

    // The supported proxy setup accepts external HTTPS, forwards over HTTP, and preserves Host.
    // Requiring these values to agree rejects partial or contradictory origin descriptions.
    if (
      proto !== "https" ||
      !host ||
      requestUrl.protocol !== "http:" ||
      requestUrl.host !== host
    ) {
      return;
    }

    // The proxy may describe the request only as one of the explicitly configured origins.
    const forwardedOrigin = new URL(`https://${host}`).origin;
    return origins.includes(forwardedOrigin) ? forwardedOrigin : undefined;
  }

  // Other requests use their direct URL; any untrusted forwarded headers are ignored.
  return origins.includes(requestUrl.origin) ? requestUrl.origin : undefined;
};

const cookieMaxAge = (expiresAt?: string) =>
  Math.min(
    neverCookieLifetimeSeconds,
    expiresAt
      ? Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1_000))
      : neverCookieLifetimeSeconds,
  );

const generateSessionCookie = ({
  origin,
  token,
  maxAge,
}: {
  origin: string;
  token: string;
  maxAge: number;
}) =>
  generateCookie(sessionCookieName, token, {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "Strict",
    ...(new URL(origin).protocol === "https:"
      ? { prefix: "host" as const }
      : {}),
  });

const createRequestAuthentication = ({
  service,
}: {
  service: AuthService;
}): RequestAuthentication => {
  // Browser sessions use HttpOnly, SameSite=Strict cookies. On HTTPS the
  // browser-enforced __Host- prefix also requires Secure, Path=/, and no Domain,
  // making the cookie host-only and resistant to subdomain replacement.
  const cookieName = (origin: string) =>
    new URL(origin).protocol === "https:"
      ? `__Host-${sessionCookieName}`
      : sessionCookieName;
  const cookieHeader = (origin: string, token: string, expiresAt?: string) =>
    generateSessionCookie({
      maxAge: cookieMaxAge(expiresAt),
      origin,
      token,
    });
  return {
    authenticate: async (request, origin) => {
      // Authorization is authoritative: an invalid header must not silently
      // fall back to a valid ambient browser cookie.
      const authorizationHeader = request.headers.get("Authorization");
      if (authorizationHeader !== null) {
        const token = bearerToken(authorizationHeader);
        const authenticatedSession = token
          ? await service.authenticateToken(token)
          : undefined;
        return authenticatedSession?.kind === "local"
          ? { ...authenticatedSession, credential: "bearer" }
          : undefined;
      }
      if (!origin) {
        return;
      }
      const name = cookieName(origin);
      const token = parseCookie(request.headers.get("Cookie") ?? "", name)[
        name
      ];
      const authenticatedSession = token
        ? await service.authenticateToken(token, origin)
        : undefined;
      return authenticatedSession?.kind === "browser"
        ? { ...authenticatedSession, credential: "cookie" }
        : undefined;
    },
    clearCookieHeader: (origin) =>
      generateSessionCookie({ maxAge: 0, origin, token: "" }),
    cookieHeader,
  };
};

export const createAuthBoundary = ({
  origins,
  service,
  trustedProxyPeer,
}: {
  origins: () => string[];
  service: AuthService;
  trustedProxyPeer?: string;
}): AuthBoundary => ({
  requests: createRequestAuthentication({ service }),
  resolveOrigin: (input) =>
    resolveRequestOrigin({
      ...input,
      origins: origins(),
      trustedProxyPeer,
    }),
  service,
});

const loginInputSchema = z.union([
  z.object({ code: z.string() }).strict(),
  z.object({ ticket: z.string() }).strict(),
]);

const parseLoginBody = async (request: Request) => {
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0]?.toLowerCase() !==
    "application/json"
  ) {
    return;
  }
  try {
    return loginInputSchema.safeParse(await request.json()).data;
  } catch {
    return;
  }
};

const hasTrustedBrowserHeaders = (request: Request, origin: string) =>
  request.headers.get("Origin") === origin &&
  request.headers.get("Sec-Fetch-Site") === "same-origin";

const changesState = (request: Request) =>
  !["GET", "HEAD", "OPTIONS"].includes(request.method);

const requestOrigin = (auth: AuthBoundary, context: Context<AuthEnvironment>) =>
  auth.resolveOrigin({
    remoteAddress: (context.env as Partial<HttpBindings> | undefined)?.incoming
      ?.socket.remoteAddress,
    request: context.req.raw,
  });

type HttpAuthenticationHandlers = {
  asset: Handler<AuthEnvironment>;
  authenticate: MiddlewareHandler<AuthEnvironment>;
  login: Handler<AuthEnvironment>;
  loginBodyLimitMiddleware: MiddlewareHandler<AuthEnvironment>;
  loginPage: Handler<AuthEnvironment>;
  logout: Handler<AuthEnvironment>;
  state: Handler<AuthEnvironment>;
};

// Browser login and cookie-authenticated mutations require the effective
// configured Origin plus same-origin Fetch Metadata. Bearer credentials are explicit rather
// than ambient browser credentials, so they do not use the browser CSRF check.
export const createHttpAuthenticationHandlers = ({
  auth,
  authAssetsDirectory,
}: {
  auth: AuthBoundary;
  authAssetsDirectory?: string;
}): HttpAuthenticationHandlers => {
  const authShell = loadAuthShell(authAssetsDirectory);
  const loginRateLimiter = createRateLimiter({
    maxAttemptsPerKey: maxLoginRequestsPerWindow,
    maxGlobalAttempts: maxGlobalLoginRequestsPerWindow,
    maxTrackedKeys: maxTrackedLoginAddresses,
    windowMs: loginWindowMs,
  });

  return {
    asset: (context) => serveAuthShellAsset(context, authShell),
    state: async (context) => {
      context.header("Cache-Control", "no-store");
      const origin = requestOrigin(auth, context);
      const session = await auth.requests.authenticate(context.req.raw, origin);
      if (session?.credential === "cookie" && origin) {
        context.header(
          "Set-Cookie",
          auth.requests.cookieHeader(origin, session.token, session.expiresAt),
        );
      }
      return context.json({ authenticated: Boolean(session) });
    },
    loginBodyLimitMiddleware: bodyLimit({
      maxSize: maxLoginBodyBytes,
      onError: (context) =>
        context.json({ error: "Login request is too large" }, 413),
    }),
    login: async (context) => {
      context.header("Cache-Control", "no-store");
      const origin = requestOrigin(auth, context);
      if (!origin || !hasTrustedBrowserHeaders(context.req.raw, origin)) {
        return context.json(
          { error: "Login request origin was rejected" },
          403,
        );
      }
      const address =
        (context.env as Partial<HttpBindings> | undefined)?.incoming?.socket
          .remoteAddress ?? "unknown";
      if (!hasRateLimitCapacity({ key: address, limiter: loginRateLimiter })) {
        return context.json({ status: "rate-limited" }, 429);
      }
      const input = await parseLoginBody(context.req.raw);
      if (!input) {
        return context.json({ error: "Invalid login request" }, 400);
      }
      const result = await auth.service.consumeLoginGrant({ ...input, origin });
      if (result.status !== "authenticated") {
        return context.json(
          { status: result.status },
          result.status === "rate-limited" ? 429 : 401,
        );
      }
      context.header(
        "Set-Cookie",
        auth.requests.cookieHeader(
          origin,
          result.token,
          result.session.expiresAt,
        ),
      );
      return context.json({ authenticated: true });
    },
    loginPage: async (context) => {
      const origin = requestOrigin(auth, context);
      const session = await auth.requests.authenticate(context.req.raw, origin);
      if (session) {
        return context.redirect("/");
      }
      return renderAuthShell(context, authShell);
    },
    authenticate: async (context, next) => {
      const origin = requestOrigin(auth, context);
      let session: RequestSession | undefined;
      try {
        session = await auth.requests.authenticate(context.req.raw, origin);
      } catch {
        context.header("Cache-Control", "no-store");
        return context.json(
          { error: "Authentication service unavailable" },
          503,
        );
      }
      if (!session) {
        if (
          !context.req.path.startsWith("/api/") &&
          isBrowserNavigation(context.req.raw)
        ) {
          return renderAuthShell(context, authShell, 401);
        }
        context.header("Cache-Control", "no-store");
        return context.json({ error: "Authentication required" }, 401);
      }
      context.set("session", session);
      context.header("Cache-Control", "private, no-store");
      if (session.credential === "cookie") {
        if (
          !origin ||
          (changesState(context.req.raw) &&
            !hasTrustedBrowserHeaders(context.req.raw, origin))
        ) {
          return context.json({ error: "Request origin was rejected" }, 403);
        }
        context.header(
          "Set-Cookie",
          auth.requests.cookieHeader(origin, session.token, session.expiresAt),
        );
      }
      await next();
    },
    logout: async (context) => {
      const session = context.get("session");
      await auth.service.revokeSession(session.id);
      if (session.origin) {
        context.header(
          "Set-Cookie",
          auth.requests.clearCookieHeader(session.origin),
        );
      }
      return context.json({ authenticated: false });
    },
  };
};
