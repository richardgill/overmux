import { describe, expect, test } from "vitest";
import { createWorkerEnvReader, parseWorkerEnv } from "./worker-env";

const bindings = {
  ENVIRONMENT: "preview",
  GIT_SHA: "test-sha",
  PUBLIC_POSTHOG_KEY: "test-token",
  SERVICE_NAME: "www",
};

describe("parseWorkerEnv", () => {
  test("uses the EU PostHog logs endpoint by default", () => {
    expect(parseWorkerEnv(bindings)).toMatchObject({
      ...bindings,
      POSTHOG_LOGS_ENDPOINT: "https://eu.i.posthog.com/i/v1/logs",
    });
  });

  test("ignores incomplete local version metadata", () => {
    expect(
      parseWorkerEnv({
        ...bindings,
        ENVIRONMENT: "local",
        VERSION_METADATA: { id: "local", tag: "", timestamp: "local" },
      }).VERSION_METADATA,
    ).toBeUndefined();
  });

  test("rejects an invalid deployment environment", () => {
    expect(() =>
      parseWorkerEnv({ ...bindings, ENVIRONMENT: "production" }),
    ).toThrow("Cloudflare ENVIRONMENT binding must be local, main, or preview");
  });
});

describe("createWorkerEnvReader", () => {
  test("loads Cloudflare bindings only once", async () => {
    let calls = 0;
    const getEnv = createWorkerEnvReader(async () => {
      calls += 1;
      return bindings;
    });

    await Promise.all([getEnv(), getEnv()]);

    expect(calls).toBe(1);
  });
});
