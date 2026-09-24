import { describe, expect, it, test as testCases, vi } from "vitest";

import { executeCallCommand } from "./call";

const jsonInputTestCases = [
  { input: "null", expectedBody: "null", name: "null" },
  { input: '"value"', expectedBody: '"value"', name: "a string" },
  { input: "42", expectedBody: "42", name: "a number" },
  { input: "false", expectedBody: "false", name: "a boolean" },
  { input: '["value"]', expectedBody: '["value"]', name: "an array" },
  {
    input: '{"task":"done"}',
    expectedBody: '{"task":"done"}',
    name: "an object",
  },
];

const getLocalCredential = vi.fn(async () => ({
  instance: {
    apiUrl: "http://127.0.0.1:4242",
    controlSocket: "/run/overmux/test.sock",
    id: "instance",
    pid: 1,
    port: 4242,
    url: "http://127.0.0.1:4242",
  },
  token: "short-lived-token",
}));

const expectedHeaders = {
  authorization: "Bearer short-lived-token",
  "content-type": "application/json",
};

describe("call command", () => {
  testCases.each(jsonInputTestCases)(
    "invokes an operation with $name input",
    async ({ expectedBody, input }) => {
      const fetch = vi.fn(async () => Response.json({ accepted: true }));

      await expect(
        executeCallCommand({
          fetch,
          getLocalCredential,
          input,
          operationName: "taskFinished",
          port: 4242,
        }),
      ).resolves.toEqual({ accepted: true });
      expect(fetch).toHaveBeenCalledWith(
        new URL("http://127.0.0.1:4242/api/operations/taskFinished"),
        { body: expectedBody, headers: expectedHeaders, method: "POST" },
      );
    },
  );

  it("sends an empty request body when input is omitted", async () => {
    const fetch = vi.fn(async () => Response.json({ accepted: true }));

    await executeCallCommand({
      fetch,
      getLocalCredential,
      operationName: "reloadTmuxConfig",
      port: 4242,
    });

    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:4242/api/operations/reloadTmuxConfig"),
      { body: undefined, headers: expectedHeaders, method: "POST" },
    );
  });

  it("rejects invalid JSON before discovering a server", async () => {
    const fetch = vi.fn();

    await expect(
      executeCallCommand({
        fetch,
        input: "{",
        operationName: "taskFinished",
        port: 4242,
      }),
    ).rejects.toThrow("Operation input must be valid JSON");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a useful server error for rejected requests", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ error: "Operation not found" }, { status: 404 }),
    );

    await expect(
      executeCallCommand({
        fetch,
        getLocalCredential,
        input: "null",
        operationName: "missing",
        port: 4242,
      }),
    ).rejects.toThrow("Operation request failed: Operation not found");
  });
});
