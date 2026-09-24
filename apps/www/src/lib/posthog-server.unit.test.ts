import { describe, expect, test, vi } from "vitest";
import {
  createServerExceptionCapture,
  type CreateServerExceptionCaptureInput,
} from "./posthog-server";
import type { WorkerEnv } from "./worker-env";

const env: WorkerEnv = {
  ENVIRONMENT: "main",
  GIT_SHA: "test-sha",
  PUBLIC_POSTHOG_KEY: "test-token",
  POSTHOG_LOGS_ENDPOINT: "https://logs.example.test/i/v1/logs",
  SERVICE_NAME: "www",
  VERSION_METADATA: { id: "version-id", tag: "version-tag", timestamp: "now" },
};

type CaptureExceptionImmediate = (
  error: unknown,
  distinctId?: string,
  properties?: Record<string, unknown>,
) => Promise<unknown>;

const createInput = (
  captureExceptionImmediate: CaptureExceptionImmediate,
): CreateServerExceptionCaptureInput => ({
  getEnv: async () => env,
  createClient: () => ({ captureExceptionImmediate }),
});

describe("createServerExceptionCapture", () => {
  test("captures an exception with safe request metadata", async () => {
    const captureExceptionImmediate = vi
      .fn<CaptureExceptionImmediate>()
      .mockResolvedValue(undefined);
    const capture = createServerExceptionCapture(
      createInput(captureExceptionImmediate),
    );

    await capture({
      error: Object.assign(new Error("failed"), { status: 503 }),
      request: new Request("https://www.example.test/docs?token=secret", {
        headers: { "cf-ray": "ray-id" },
      }),
      routePath: "/docs",
    });

    expect(captureExceptionImmediate).toHaveBeenCalledWith(
      expect.any(Error),
      "ray-id",
      expect.objectContaining({
        service: "www",
        environment: "main",
        gitSha: "test-sha",
        method: "GET",
        path: "/docs",
        routePath: "/docs",
        requestId: "ray-id",
        status: 503,
        url: "https://www.example.test/docs",
        scriptVersion: env.VERSION_METADATA,
      }),
    );
    expect(JSON.stringify(captureExceptionImmediate.mock.calls)).not.toContain(
      "secret",
    );
  });

  test("does not mask the original exception when capture fails", async () => {
    const captureExceptionImmediate = vi
      .fn<CaptureExceptionImmediate>()
      .mockRejectedValue(new Error("PostHog unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const capture = createServerExceptionCapture(
      createInput(captureExceptionImmediate),
    );

    await expect(
      capture({
        error: new Error("original exception"),
        request: new Request("https://www.example.test/"),
        routePath: "/",
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      "posthog_capture_exception_failed",
      {
        error: "PostHog unavailable",
      },
    );
  });
});
