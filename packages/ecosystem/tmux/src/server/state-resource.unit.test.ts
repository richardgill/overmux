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
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
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
  it("refreshes reads even when there is no active subscriber", async () => {
    const { backend, publish } = setup();
    const releaseLogger = vi.fn();
    backend.observeDiagnostics = vi.fn(() => releaseLogger);
    const resource = tmuxResource({ backend });
    const readContext = context();
    await resource.read(undefined, readContext);
    expect(backend.observeDiagnostics).toHaveBeenCalledWith(readContext.logger);
    publish(tmuxState("changed externally"));
    expect(
      (await resource.read(undefined, context())).hierarchy.sessions[0]?.name,
    ).toBe("changed externally");
    expect(backend.refresh).toHaveBeenCalledTimes(2);
    expect(backend.observeDiagnostics).toHaveBeenCalledTimes(2);
    expect(releaseLogger).toHaveBeenCalledTimes(2);
  });

  it("releases the read diagnostic logger when refresh fails", async () => {
    const { backend } = setup();
    const releaseLogger = vi.fn();
    backend.observeDiagnostics = vi.fn(() => releaseLogger);
    vi.mocked(backend.refresh).mockRejectedValue(new Error("refresh failed"));
    const resource = tmuxResource({ backend });

    await expect(resource.read(undefined, context())).rejects.toThrow(
      "refresh failed",
    );

    expect(releaseLogger).toHaveBeenCalledOnce();
  });

  it("subscribes immediately and reads invalidated cached state", async () => {
    const { backend, publish } = setup();
    const resource = tmuxResource({ backend });
    const invalidate = vi.fn();
    const dispose = await resource.subscribe(undefined, invalidate, context());

    expect(backend.subscribe).toHaveBeenCalledOnce();
    expect(
      (await resource.read(undefined, context())).hierarchy.sessions[0]?.name,
    ).toBe("initial");

    publish(tmuxState("updated"));
    expect(invalidate).toHaveBeenCalledOnce();
    expect(
      (await resource.read(undefined, context())).hierarchy.sessions[0]?.name,
    ).toBe("updated");

    await dispose();
    publish(tmuxState("later"));
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
