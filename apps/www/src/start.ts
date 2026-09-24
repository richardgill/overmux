import { createMiddleware, createStart } from "@tanstack/react-start";
import { captureServerException } from "@/lib/posthog-server";
import { getWorkerEnv, hasWorkerEnv } from "@/lib/worker-env";
import { createInvocationLogger } from "@/lib/worker-logs";

const getRoutePath = (request: Request) => {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith("/docs/") ? "/docs/$" : pathname;
};

const webInvocationLogger = createMiddleware().server(
  async ({ next, request }) => {
    if (!hasWorkerEnv) {
      return await next();
    }

    const start = Date.now();
    const routePath = getRoutePath(request);
    const env = await getWorkerEnv();
    const logger = createInvocationLogger({ env, name: "web_invocation" });
    try {
      const result = await next();
      await logger.log({
        request,
        routePath,
        start,
        httpStatus: result.response.status,
      });
      return result;
    } catch (error) {
      await logger.log({ request, routePath, start, error });
      await captureServerException({ error, request, routePath });
      throw error;
    }
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [webInvocationLogger],
}));
