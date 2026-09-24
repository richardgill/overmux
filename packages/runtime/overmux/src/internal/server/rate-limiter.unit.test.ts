import { describe, expect, it } from "vitest";

import { createRateLimiter, hasRateLimitCapacity } from "./rate-limiter";

const createLimiter = () =>
  createRateLimiter({
    maxAttemptsPerKey: 2,
    maxGlobalAttempts: 3,
    maxTrackedKeys: 100,
    windowMs: 1_000,
  });

describe("rolling-window rate limiter", () => {
  it("enforces per-key and global attempt limits", () => {
    const limiter = createLimiter();

    expect(hasRateLimitCapacity({ currentTime: 0, key: "a", limiter })).toBe(
      true,
    );
    expect(hasRateLimitCapacity({ currentTime: 1, key: "a", limiter })).toBe(
      true,
    );
    expect(hasRateLimitCapacity({ currentTime: 2, key: "a", limiter })).toBe(
      false,
    );
    expect(hasRateLimitCapacity({ currentTime: 2, key: "b", limiter })).toBe(
      true,
    );
    expect(hasRateLimitCapacity({ currentTime: 3, key: "c", limiter })).toBe(
      false,
    );
  });

  it("restores capacity when attempts leave the rolling window", () => {
    const limiter = createLimiter();
    hasRateLimitCapacity({ currentTime: 0, key: "a", limiter });
    hasRateLimitCapacity({ currentTime: 1, key: "a", limiter });

    expect(
      hasRateLimitCapacity({ currentTime: 1_000, key: "a", limiter }),
    ).toBe(true);
  });

  it("bounds tracked key state", () => {
    const limiter = createRateLimiter({
      maxAttemptsPerKey: 1,
      maxGlobalAttempts: 10,
      maxTrackedKeys: 1,
      windowMs: 1_000,
    });

    hasRateLimitCapacity({ currentTime: 0, key: "a", limiter });
    hasRateLimitCapacity({ currentTime: 0, key: "b", limiter });

    expect(limiter.attemptsByKey.size).toBe(0);
  });
});
