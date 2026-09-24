import type { ServerLifecycleEvent } from "../../shared/index";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientTransport, TransportStatus } from "../transport";
import { UpdatePopover } from "./update-popover";

let container: HTMLDivElement;
let root: Root;
let lifecycle: (event: ServerLifecycleEvent) => void;
let status: (status: TransportStatus) => void;

const transport = {
  subscribeLifecycle: vi.fn((listener) => {
    lifecycle = listener;
    return () => undefined;
  }),
  subscribeStatus: vi.fn((listener) => {
    status = listener;
    listener("connected");
    return () => undefined;
  }),
} as unknown as ClientTransport;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("update popover", () => {
  it("requests restart only after the user selects Reload", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      new Response(undefined, {
        status: 202,
      }),
    );
    vi.stubGlobal("fetch", fetchRequest);
    await act(async () => root.render(<UpdatePopover transport={transport} />));

    await act(async () => lifecycle({ type: "update-available" }));
    expect(container.textContent).toContain(
      "A new version is available. Reload to update.",
    );
    expect(fetchRequest).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(fetchRequest).toHaveBeenNthCalledWith(1, "/api/restart", {
      method: "POST",
    });
    expect(fetchRequest).toHaveBeenNthCalledWith(
      2,
      "/api/health",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(container.textContent).toContain("Restarting Overmux");
  });

  it("starts health polling immediately and shows only restart recovery", async () => {
    const fetchRequest = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchRequest);
    await act(async () => root.render(<UpdatePopover transport={transport} />));

    await act(async () => lifecycle({ type: "restarting" }));

    expect(container.textContent).toContain("Waiting for the new version.");
    expect(container.querySelector("[data-om-reconnecting]")).toBeNull();
    expect(fetchRequest).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
