import { afterEach, describe, expect, it, vi } from "vitest";

import { delay } from "./delay";

afterEach(() => vi.useRealTimers());

describe("delay", () => {
  it("resolves after the requested duration", async () => {
    vi.useFakeTimers();
    const resolved = vi.fn();
    void delay(250).then(resolved);

    await vi.advanceTimersByTimeAsync(249);
    expect(resolved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toHaveBeenCalledOnce();
  });
});
