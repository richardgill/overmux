import { describe, expect, it, vi } from "vitest";

import type { TmuxState } from "../shared/state-contract";
import type { TmuxBackend } from "./backend";
import { tmuxResource } from "./state-resource";

const tmuxState = (name: string): TmuxState => ({
  backend: { id: "test" },
  connected: true,
  hierarchy: {
    sessions: [
      {
        activeWindowId: "@1",
        id: "$1",
        name,
        windows: [],
      },
    ],
  },
});

const context = () => ({
  instance: {
    getInstanceId: () => "test",
    getDeepLinkPrefix: () => "overmux://test",
  },
  invalidate: () => undefined,
  notifications: { send: async () => undefined },
  signal: new AbortController().signal,
});

const setup = () => {
  const listeners = new Set<() => void>();
  let state = tmuxState("initial");
  const backend = {
    refresh: vi.fn(async () => state),
    state: () => state,
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as unknown as TmuxBackend;
  return {
    backend,
    publish: (next: TmuxState) => {
      state = next;
      listeners.forEach((listener) => listener());
    },
  };
};

describe("tmux state resource", () => {
  it("subscribes immediately and reads invalidated cached state", async () => {
    const { backend, publish } = setup();
    const resource = tmuxResource({ backend });
    const invalidate = vi.fn();
    const dispose = resource.subscribe(undefined, invalidate, context());

    expect(backend.subscribe).toHaveBeenCalledOnce();
    expect(
      (await resource.read(undefined, context())).hierarchy.sessions[0]?.name,
    ).toBe("initial");

    publish(tmuxState("updated"));
    expect(invalidate).toHaveBeenCalledOnce();
    expect(
      (await resource.read(undefined, context())).hierarchy.sessions[0]?.name,
    ).toBe("updated");

    dispose();
    publish(tmuxState("later"));
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
