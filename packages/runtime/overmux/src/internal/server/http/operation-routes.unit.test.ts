import { describe, expect, it, test as testCases, vi } from "vitest";

import { createAuthenticatedTestHttpApp } from "./authenticated-http-app-test-helper";
import type { ServerLogger } from "../server-logger";

type Operation = {
  execute: (input: unknown, signal: AbortSignal) => Promise<unknown>;
  returnsVoid: boolean;
};

const createApp = (
  operations: Record<string, Operation>,
  serverLogger?: ServerLogger,
) =>
  createAuthenticatedTestHttpApp({
    runtime: {
      getOperation: (name: string) => operations[name],
    } as never,
    serverLogger,
  });

const request = (body?: string) => ({
  body,
  headers: { "content-type": "application/json" },
  method: "POST",
});

const invalidRequests = [
  {
    expectedStatus: 415,
    init: {
      body: "{}",
      headers: { "content-type": "text/plain" },
      method: "POST",
    },
    name: "non-JSON content",
  },
  {
    expectedStatus: 400,
    init: request("{"),
    name: "malformed JSON",
  },
  {
    expectedStatus: 413,
    init: request(JSON.stringify("x".repeat(1_048_576))),
    name: "oversized input",
  },
] as const;

describe("operation HTTP ingress", () => {
  it("waits for output and correlates operation and HTTP logs", async () => {
    const execute = vi.fn(async (input) => ({ echoed: input }));
    const log = vi.fn();
    const app = createApp(
      { refresh: { execute, returnsVoid: false } },
      { enabled: true, id: () => "request-1", log },
    );

    const response = await app.request(
      "http://overmux.test/api/operations/refresh",
      request(JSON.stringify({ workspace: "main" })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Overmux-Correlation-Id")).toBe("request-1");
    expect(await response.json()).toEqual({ echoed: { workspace: "main" } });
    expect(execute).toHaveBeenCalledOnce();
    expect(log.mock.calls.map(([entry]) => entry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correlationId: "request-1",
          event: "operation-start",
        }),
        expect.objectContaining({
          correlationId: "request-1",
          event: "operation-complete",
        }),
        expect.objectContaining({
          correlationId: "request-1",
          event: "http-request",
        }),
      ]),
    );
  });

  it("returns 204 for void operations and 404 for unknown names", async () => {
    const app = createApp({
      refresh: { execute: vi.fn(async () => undefined), returnsVoid: true },
    });

    const completed = await app.request(
      "http://overmux.test/api/operations/refresh",
      request(),
    );
    const missing = await app.request(
      "http://overmux.test/api/operations/missing",
      request(),
    );

    expect(completed.status).toBe(204);
    expect(await completed.text()).toBe("");
    expect(missing.status).toBe(404);
  });

  testCases.each(invalidRequests)(
    "rejects $name",
    async ({ expectedStatus, init }) => {
      const execute = vi.fn(async () => undefined);
      const app = createApp({ refresh: { execute, returnsVoid: true } });

      const response = await app.request(
        "http://overmux.test/api/operations/refresh",
        init,
      );

      expect(response.status).toBe(expectedStatus);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("cancels the handler signal with the HTTP request", async () => {
    let operationSignal: AbortSignal | undefined;
    let resolveOperation: () => void = () => undefined;
    const execute = vi.fn(
      (_input: unknown, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          operationSignal = signal;
          resolveOperation = resolve;
        }),
    );
    const app = createApp({ refresh: { execute, returnsVoid: true } });
    const controller = new AbortController();
    const pending = app.request("http://overmux.test/api/operations/refresh", {
      ...request(),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    controller.abort();

    expect(operationSignal?.aborted).toBe(true);
    resolveOperation();
    await expect(pending).resolves.toHaveProperty("status", 204);
  });
});
