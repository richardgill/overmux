import type { HttpBindings } from "@hono/node-server";
import { proxyFetch } from "httpxy";
import type { Handler } from "hono";

import type { AuthBoundary, AuthEnvironment } from "../auth/auth-http";
import { errorDetails, type ServerLogger } from "../server-logger";

const createForwardingHeaders = ({
  origin,
  remoteAddress,
  request,
}: {
  origin: string;
  remoteAddress?: string;
  request: Request;
}) => {
  const headers = new Headers(request.headers);
  [...headers.keys()].forEach((name) => {
    if (
      name === "authorization" ||
      name === "cookie" ||
      name === "forwarded" ||
      name.startsWith("x-forwarded-")
    ) {
      headers.delete(name);
    }
  });
  const publicUrl = new URL(origin);
  if (remoteAddress) {
    headers.set("x-forwarded-for", remoteAddress);
  }
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set(
    "x-forwarded-port",
    publicUrl.port || (publicUrl.protocol === "https:" ? "443" : "80"),
  );
  headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
  return headers;
};

export const createDevelopmentWebHandler =
  ({
    auth,
    serverLogger,
    target,
  }: {
    auth: AuthBoundary;
    serverLogger?: ServerLogger;
    target: string;
  }): Handler<AuthEnvironment> =>
  async (context) => {
    const incoming = (context.env as Partial<HttpBindings> | undefined)
      ?.incoming;
    const origin = auth.resolveOrigin({
      remoteAddress: incoming?.socket.remoteAddress,
      request: context.req.raw,
    });
    if (!origin) {
      return context.text("Request origin was rejected", 403);
    }
    const headers = createForwardingHeaders({
      origin,
      remoteAddress: incoming?.socket.remoteAddress,
      request: context.req.raw,
    });
    try {
      return await proxyFetch(
        target,
        new Request(context.req.raw, { headers }),
        undefined,
        { changeOrigin: true, xfwd: false },
      );
    } catch (cause) {
      serverLogger?.log({
        details: errorDetails(cause),
        event: "vite-http-proxy-failure",
        level: "error",
      });
      return context.text("Overmux development server is unavailable", 503, {
        "Cache-Control": "no-store",
      });
    }
  };
