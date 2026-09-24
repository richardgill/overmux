import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthState, login } from "./auth-api";

afterEach(() => vi.unstubAllGlobals());

describe("authentication API", () => {
  it("checks auth state without caching", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ authenticated: true })));
    vi.stubGlobal("fetch", fetch);

    await expect(getAuthState()).resolves.toEqual({ authenticated: true });

    expect(fetch).toHaveBeenCalledWith("/api/auth/state", {
      cache: "no-store",
      signal: undefined,
    });
  });

  it("exchanges a login code through the same-origin auth endpoint", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ authenticated: true })));
    vi.stubGlobal("fetch", fetch);

    await expect(login({ code: "ABCD-EFGH" })).resolves.toEqual({
      status: "authenticated",
    });

    expect(fetch).toHaveBeenCalledWith("/api/auth/login", {
      body: JSON.stringify({ code: "ABCD-EFGH" }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: undefined,
    });
  });

  it("preserves known login failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ status: "expired" }), { status: 401 }),
        ),
    );

    await expect(login({ ticket: "ticket" })).resolves.toEqual({
      status: "expired",
    });
  });

  it("rejects failed or malformed authentication state responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 502 })),
    );

    await expect(getAuthState()).rejects.toThrow(
      "Authentication state request failed",
    );
  });
});
