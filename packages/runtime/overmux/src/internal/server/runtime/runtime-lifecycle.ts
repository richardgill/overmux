// Composes runtime and request cancellation while owning asynchronous cleanup.
// Tracked disposers run exactly once, and aggregate shutdown reports every failure.

import type { RuntimeDisposer } from "../../../public/index";

export type RuntimeLifecycle = {
  completePreparation: () => void;
  dispose: (reason?: unknown) => Promise<void>;
  disposeAll: (disposers: Iterable<RuntimeDisposer>) => Promise<void>;
  requestSignal: (signal?: AbortSignal) => AbortSignal;
  signal: AbortSignal;
  track: (dispose: RuntimeDisposer, signal?: AbortSignal) => RuntimeDisposer;
};

const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));

const disposeAll = async (disposers: Iterable<RuntimeDisposer>) => {
  const results = await Promise.allSettled(
    [...disposers].map(async (dispose) => dispose()),
  );
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [asError(result.reason)] : [],
  );
  if (errors.length) {
    throw new AggregateError(errors, "Runtime disposal failed");
  }
};

export const createRuntimeLifecycle = (
  preparationSignal?: AbortSignal,
): RuntimeLifecycle => {
  const controller = new AbortController();
  const activeDisposers = new Set<RuntimeDisposer>();
  let disposal: Promise<void> | undefined;
  const abortPreparation = () => controller.abort(preparationSignal?.reason);
  preparationSignal?.addEventListener("abort", abortPreparation, {
    once: true,
  });
  if (preparationSignal?.aborted) {
    abortPreparation();
  }

  const completePreparation = () => {
    preparationSignal?.removeEventListener("abort", abortPreparation);
  };
  const requestSignal = (signal?: AbortSignal) =>
    signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  const track = (
    dispose: RuntimeDisposer,
    signal?: AbortSignal,
  ): RuntimeDisposer => {
    let pending: Promise<void> | undefined;
    const disposeOnce = () => {
      if (pending) {
        return pending;
      }
      controller.signal.removeEventListener("abort", onAbort);
      signal?.removeEventListener("abort", onAbort);
      activeDisposers.delete(disposeOnce);
      pending = Promise.resolve().then(dispose);
      return pending;
    };
    const onAbort = () => {
      void disposeOnce().catch(() => undefined);
    };
    activeDisposers.add(disposeOnce);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted || signal?.aborted) {
      onAbort();
    }
    return disposeOnce;
  };
  const dispose = (reason: unknown = new Error("Runtime disposed")) => {
    if (disposal) {
      return disposal;
    }
    completePreparation();
    const pending = [...activeDisposers];
    activeDisposers.clear();
    controller.abort(reason);
    disposal = disposeAll(pending);
    return disposal;
  };

  return {
    completePreparation,
    dispose,
    disposeAll,
    requestSignal,
    signal: controller.signal,
    track,
  };
};
