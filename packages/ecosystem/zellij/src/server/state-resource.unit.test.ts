import { describe, expect, it, vi } from "vitest";

import type { ZellijState } from "../shared/state-contract";
import type { ZellijBackend } from "./backend";
import { zellijStateResource } from "./state-resource";

const state: ZellijState = {
  backend: { id: "zellij" },
  connected: true,
  sessions: [],
};
const context = (signal: AbortSignal) => ({
  instance: {
    getInstanceId: () => "test",
    getDeepLinkPrefix: () => "overmux://test",
  },
  invalidate: () => undefined,
  notifications: { send: async () => undefined },
  signal,
});

describe("Zellij state resource", () => {
  it("reads authoritative state and closes the backend after the final subscriber", async () => {
    let publish: (() => void) | undefined;
    const close = vi.fn(async () => undefined);
    const backend = {
      close,
      read: vi.fn(async () => state),
      subscribe: vi.fn((listener: () => void) => {
        publish = listener;
        return () => undefined;
      }),
    } as unknown as ZellijBackend;
    const resource = zellijStateResource({ backend });
    const controller = new AbortController();
    const invalidate = vi.fn();

    expect(await resource.read(undefined, context(controller.signal))).toBe(
      state,
    );
    const dispose = resource.subscribe(
      undefined,
      invalidate,
      context(controller.signal),
    );
    publish?.();
    expect(invalidate).toHaveBeenCalledOnce();

    await dispose?.();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
});
