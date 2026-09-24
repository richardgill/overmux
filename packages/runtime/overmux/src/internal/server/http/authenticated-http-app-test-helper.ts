import type { AuthService } from "../auth/auth-service";
import type { RequestAuthentication } from "../auth/auth-http";
import { createHttpApp, type HttpAppOptions } from "./create-http-app";

const origin = "http://localhost";

const auth: AuthService = {
  authenticateToken: async () => undefined,
  consumeLoginGrant: async () => ({ status: "invalid" }),
  createLoginGrant: async () => {
    throw new Error("Not implemented in authenticated HTTP tests");
  },
  isSessionActive: async () => true,
  issueLocalBearer: async () => {
    throw new Error("Not implemented in authenticated HTTP tests");
  },
  listSessions: async () => [],
  onSessionsRevoked: () => () => undefined,
  revokeAllSessions: async () => 0,
  revokeSession: async () => false,
  setOrigins: () => undefined,
};

const authentication: RequestAuthentication = {
  authenticate: async () => ({
    credential: "bearer",
    id: "test-session",
    kind: "local",
    token: "test-token",
  }),
  clearCookieHeader: () => "",
  cookieHeader: () => "",
};

type TestHttpAppOptions = Omit<HttpAppOptions, "auth">;

export const createAuthenticatedTestHttpApp = (options: TestHttpAppOptions) =>
  createHttpApp({
    ...options,
    auth: {
      requests: authentication,
      resolveOrigin: () => origin,
      service: auth,
    },
  });
