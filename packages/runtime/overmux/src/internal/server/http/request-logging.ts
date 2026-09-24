// Adds request correlation IDs and emits the final HTTP request log entry.
// Logging runs after the matched middleware and route handler complete.
import type { MiddlewareHandler } from "hono";

import type { AuthEnvironment } from "../auth/auth-http";
import type { ServerLogger } from "../server-logger";

export const createRequestLoggingMiddleware =
  ({
    serverLogger,
  }: {
    serverLogger?: ServerLogger;
  }): MiddlewareHandler<AuthEnvironment> =>
  async (context, next) => {
    const correlationId = serverLogger?.id();
    const startedAt = Date.now();
    if (correlationId) {
      context.header("X-Overmux-Correlation-Id", correlationId);
    }
    await next();
    const failed = context.res.status >= 400 || Boolean(context.error);
    serverLogger?.log({
      correlationId,
      details: {
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
      },
      durationMs: Date.now() - startedAt,
      event: failed ? "http-request-failure" : "http-request",
      level: failed ? "error" : undefined,
      message: context.error?.message,
    });
  };
