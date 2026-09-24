import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  test as testCases,
  vi,
} from "vitest";
import { createInvocationLogger, getHttpStatusSeverity } from "./worker-logs";
import type { WorkerEnv } from "./worker-env";

const env: WorkerEnv = {
  ENVIRONMENT: "local",
  GIT_SHA: "test-sha",
  PUBLIC_POSTHOG_KEY: "test-token",
  POSTHOG_LOGS_ENDPOINT: "https://logs.example.test/i/v1/logs",
  SERVICE_NAME: "www",
};

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 200 }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createInvocationLogger", () => {
  test("sends a redacted OTEL invocation record", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const request = Object.assign(
      new Request("https://www.example.test/docs?token=secret", {
        headers: {
          accept: "text/html",
          authorization: "Bearer secret",
          cookie: "session=secret",
          "cf-ray": "ray-id",
          "x-private-header": "secret",
        },
      }),
      {
        cf: {
          colo: "LHR",
          country: "GB",
          city: "London",
          clientIp: "192.0.2.1",
          botManagement: { score: 99, staticResource: true },
        },
      },
    );
    const logger = createInvocationLogger({ env, name: "web_invocation_v1" });

    await logger.log({
      request,
      routePath: "/docs",
      start: Date.now(),
      httpStatus: 200,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    const record = JSON.parse(
      body.resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue,
    );
    expect(record).toMatchObject({
      path: "/docs",
      routePath: "/docs",
      requestId: "ray-id",
      hasQuery: true,
      url: "https://www.example.test/docs",
      headers: { accept: "text/html", "cf-ray": "ray-id" },
      cf: { colo: "LHR", country: "GB", botManagement: { score: 99 } },
    });
    expect(JSON.stringify(record)).not.toContain("secret");
    expect(JSON.stringify(record)).not.toContain("192.0.2.1");
    expect(record.cf).not.toHaveProperty("city");
    expect(body.resourceLogs[0].resource.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "service.name",
          value: { stringValue: "www" },
        }),
      ]),
    );
  });

  test("does not throw when PostHog rejects the log", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const logger = createInvocationLogger({ env, name: "web_invocation_v1" });

    await expect(
      logger.log({
        request: new Request("https://www.example.test/"),
        routePath: "/",
        start: Date.now(),
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      "web_invocation_posthog_send_failed",
      {
        error: "network unavailable",
      },
    );
  });

  test("uses waitUntil without delaying the request", async () => {
    const waitUntil = vi.fn();
    const logger = createInvocationLogger({
      env,
      name: "web_invocation_v1",
      waitUntil,
    });

    await logger.log({
      request: new Request("https://www.example.test/"),
      routePath: "/",
      start: Date.now(),
    });

    expect(waitUntil).toHaveBeenCalledOnce();
  });
});

describe("getHttpStatusSeverity", () => {
  const severityCases = [
    { name: "success", status: 200, severity: "INFO" },
    { name: "rate limiting", status: 429, severity: "WARN" },
    { name: "server error", status: 500, severity: "ERROR" },
  ] as const;

  testCases.each(severityCases)(
    "returns $severity for $name",
    ({ status, severity }) => {
      expect(getHttpStatusSeverity(status)).toBe(severity);
    },
  );
});
