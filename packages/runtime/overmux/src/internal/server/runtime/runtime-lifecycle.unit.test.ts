import { describe, expect, it, vi } from "vitest";

import { createRuntimeLifecycle } from "./runtime-lifecycle";

describe("runtime lifecycle", () => {
  it("composes preparation, runtime, and request cancellation", async () => {
    const preparation = new AbortController();
    const request = new AbortController();
    const lifecycle = createRuntimeLifecycle(preparation.signal);
    const requestSignal = lifecycle.requestSignal(request.signal);
    const interruptedPreparation = new AbortController();
    const interrupted = createRuntimeLifecycle(interruptedPreparation.signal);

    interruptedPreparation.abort(new Error("preparation stopped"));
    expect(interrupted.signal.aborted).toBe(true);
    await interrupted.dispose();

    request.abort(new Error("request stopped"));

    expect(requestSignal.aborted).toBe(true);
    expect(lifecycle.signal.aborted).toBe(false);

    lifecycle.completePreparation();
    preparation.abort(new Error("preparation stopped"));

    expect(lifecycle.signal.aborted).toBe(false);
    await lifecycle.dispose();
    expect(lifecycle.signal.aborted).toBe(true);
  });

  it("runs tracked disposers once and aggregates shutdown failures", async () => {
    const lifecycle = createRuntimeLifecycle();
    const firstError = new Error("first failed");
    const secondError = new Error("second failed");
    const first = vi.fn(async () => {
      throw firstError;
    });
    const second = vi.fn(async () => {
      throw secondError;
    });
    lifecycle.track(first);
    lifecycle.track(second);

    const disposal = lifecycle.dispose();

    expect(lifecycle.signal.aborted).toBe(true);
    await expect(disposal).rejects.toMatchObject({
      errors: [firstError, secondError],
      message: "Runtime disposal failed",
    });
    await expect(lifecycle.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("disposes request-owned work immediately without unhandled rejection", async () => {
    const lifecycle = createRuntimeLifecycle();
    const request = new AbortController();
    const dispose = vi.fn(async () => {
      throw new Error("request cleanup failed");
    });
    const tracked = lifecycle.track(dispose, request.signal);

    request.abort();
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledOnce();
    await expect(tracked()).rejects.toThrow("request cleanup failed");
    await lifecycle.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
