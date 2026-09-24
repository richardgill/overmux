import { describe, expect, it, vi } from "vitest";

import { createClientTransport } from "./transport";

describe("client operation transport", () => {
  it("posts operation input and forwards cancellation", async () => {
    const fetch = vi.fn(async () => new Response(undefined, { status: 204 }));
    const controller = new AbortController();
    const transport = createClientTransport({ fetch });

    await expect(
      transport.invokeOperation({
        input: { workspace: "main" },
        name: "refresh workspace",
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/api/operations/refresh%20workspace", {
      body: '{"workspace":"main"}',
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
  });

  it("returns JSON output and surfaces server errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ refreshed: true }))
      .mockResolvedValueOnce(
        Response.json({ error: "Operation failed" }, { status: 500 }),
      );
    const transport = createClientTransport({ fetch });

    await expect(
      transport.invokeOperation({ name: "refresh" }),
    ).resolves.toEqual({ refreshed: true });
    await expect(
      transport.invokeOperation({ name: "refresh" }),
    ).rejects.toThrow("Operation failed");
  });
});
