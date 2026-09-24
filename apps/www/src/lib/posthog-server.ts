import { PostHog } from "posthog-node";
import {
  getErrorHttpStatus,
  getRequestId,
  getRequestTelemetry,
} from "./request-telemetry";
import { getWorkerEnv, type WorkerEnv } from "./worker-env";

type ExceptionClient = {
  captureExceptionImmediate: (
    error: unknown,
    distinctId?: string,
    properties?: Record<string, unknown>,
  ) => Promise<unknown>;
};

export type CaptureServerExceptionInput = {
  error: unknown;
  request: Request;
  routePath: string;
  properties?: Record<string, unknown>;
};

export type CreateServerExceptionCaptureInput = {
  getEnv: () => Promise<WorkerEnv>;
  createClient: (token: string) => ExceptionClient;
};

const getExceptionProperties = ({
  env,
  input,
}: {
  env: WorkerEnv;
  input: CaptureServerExceptionInput;
}) => {
  const requestId = getRequestId(input.request);
  const { httpStatus, ...requestTelemetry } = getRequestTelemetry({
    env,
    httpStatus: getErrorHttpStatus(input.error),
    request: input.request,
    requestId,
    routePath: input.routePath,
  });

  return {
    service: env.SERVICE_NAME,
    environment: env.ENVIRONMENT,
    ...requestTelemetry,
    status: httpStatus,
    ...input.properties,
  };
};

export const createServerExceptionCapture =
  ({ createClient, getEnv }: CreateServerExceptionCaptureInput) =>
  async (input: CaptureServerExceptionInput) => {
    try {
      const env = await getEnv();
      const properties = getExceptionProperties({ env, input });
      await createClient(env.PUBLIC_POSTHOG_KEY).captureExceptionImmediate(
        input.error,
        properties.requestId,
        properties,
      );
    } catch (error) {
      console.error("posthog_capture_exception_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

const createPostHogClient = (token: string): ExceptionClient =>
  new PostHog(token, {
    host: "https://eu.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
  });

export const captureServerException = createServerExceptionCapture({
  getEnv: getWorkerEnv,
  createClient: createPostHogClient,
});
