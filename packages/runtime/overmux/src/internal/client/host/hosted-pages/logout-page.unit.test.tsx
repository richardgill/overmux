import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HostedLogoutPage } from "./logout-page";

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted logout", () => {
  it("deduplicates remounts, reports failure, and redirects after a successful delayed retry", async () => {
    vi.useFakeTimers();
    const replace = vi.fn();
    const fetchRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchRequest);
    vi.stubGlobal("location", { replace });
    const container = document.createElement("div");
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <StrictMode>
          <HostedLogoutPage />
        </StrictMode>,
      );
    });

    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(fetchRequest).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(container.textContent).toContain("Logging out…");
    await act(async () => vi.advanceTimersByTimeAsync(2_999));
    expect(container.textContent).toContain("Logging out…");
    expect(replace).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(container.textContent).toContain("Log out failed");
    expect(container.textContent).toContain("Check your connection");
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-om-hosted-retry]")
        ?.click();
    });
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Logging out…");

    await act(async () => vi.advanceTimersByTimeAsync(2_999));
    expect(replace).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/login");
  });
});
