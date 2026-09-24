import type { WorkerEnv } from "./worker-env";

export type RequestTelemetryInput = {
  env: WorkerEnv;
  httpStatus: number;
  request: Request;
  requestId?: string;
  routePath: string;
};

export const getErrorHttpStatus = (error: unknown) => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : 500;
};

export const getRequestId = (request: Request, fallback?: string) =>
  request.headers.get("cf-ray") ?? fallback;

export const getRequestTelemetry = ({
  env,
  httpStatus,
  request,
  requestId,
  routePath,
}: RequestTelemetryInput) => {
  const url = new URL(request.url);
  return {
    gitSha: env.GIT_SHA,
    httpStatus,
    method: request.method,
    path: url.pathname,
    requestId,
    routePath,
    scriptVersion: env.VERSION_METADATA,
    url: `${url.origin}${url.pathname}`,
  };
};
