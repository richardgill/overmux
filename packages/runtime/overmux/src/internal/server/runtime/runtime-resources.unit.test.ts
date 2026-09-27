import {
  defineResourceContract,
  type RuntimeDisposer,
  type SubscriptionResourceDefinition,
} from "../../../public/index";
import { describe, expect, it, test as testCases, vi } from "vitest";
import { z } from "zod";

import { createRuntimeLifecycle } from "./runtime-lifecycle";
import { createRuntimeInstance } from "./runtime-instance";
import {
  createRuntimeResources,
  type RuntimeResourceDefinitions,
} from "./runtime-resources";

const input = z.object({ value: z.number() });
const countContract = defineResourceContract({
  input,
  output: z.object({ count: z.number() }),
});
const doubledContract = defineResourceContract({
  input,
  output: z.object({ doubled: z.number() }),
});

type Subscribe = SubscriptionResourceDefinition<
  typeof countContract.input,
  typeof countContract.output
>["subscribe"];

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

const prepareResources = (definitions: RuntimeResourceDefinitions) => {
  const lifecycle = createRuntimeLifecycle();
  const resources = createRuntimeResources({
    definitions,
    instance: createRuntimeInstance("test").context,
    lifecycle,
  });
  return { lifecycle, resources };
};

const sourceDefinition = (subscribe: Subscribe) => ({
  contract: countContract,
  kind: "subscription" as const,
  read: ({ value }: z.output<typeof input>) => ({ count: value }),
  subscribe,
});

describe("runtime resources", () => {
  it("reads dependency values and invalidates matching transitive instances", async () => {
    const lifecycle = createRuntimeLifecycle();
    const invalidators = new Map<number, () => void>();
    const disposeWatcher = vi.fn();
    const resources = createRuntimeResources({
      definitions: {
        source: {
          contract: countContract,
          kind: "subscription",
          read: ({ value }) => ({ count: value }),
          subscribe: ({ value }, invalidate) => {
            invalidators.set(value, invalidate);
            return disposeWatcher;
          },
        },
        unrelated: {
          contract: countContract,
          kind: "query",
          read: ({ value }) => ({ count: value }),
        },
        doubled: {
          combine: ({ source }) => ({ doubled: source.count * 2 }),
          contract: doubledContract,
          dependencies: { source: "source" },
          kind: "derived",
        },
      },
      instance: createRuntimeInstance("test").context,
      lifecycle,
    });
    expect(resources.names).toEqual(["source", "unrelated", "doubled"]);
    const doubled = resources.get("doubled")!;
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unrelatedListener = vi.fn();
    await resources
      .get("unrelated")!
      .subscribe({ value: 3 }, unrelatedListener);
    unrelatedListener.mockClear();

    await expect(doubled.read({ value: 3 })).resolves.toEqual({ doubled: 6 });
    const disposeFirst = await doubled.subscribe({ value: 2 }, firstListener);
    const disposeSecond = await doubled.subscribe({ value: 3 }, secondListener);
    firstListener.mockClear();
    secondListener.mockClear();
    invalidators.get(2)?.();

    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();

    expect(() =>
      resources.invalidate("source", { value: "invalid" }),
    ).toThrow();
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();

    resources.invalidate("source", { value: 3, ignored: true });
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).toHaveBeenCalledOnce();

    resources.invalidate("source");
    expect(firstListener).toHaveBeenCalledTimes(2);
    expect(secondListener).toHaveBeenCalledTimes(2);
    expect(unrelatedListener).not.toHaveBeenCalled();

    await Promise.all([disposeFirst(), disposeSecond()]);
    await lifecycle.dispose();
    expect(disposeWatcher).toHaveBeenCalledTimes(2);
  });

  testCases.each(["synchronous", "asynchronous"] as const)(
    "supports %s setup and refreshes only the new subscriber",
    async (setupKind) => {
      const cleanup = vi.fn(async () => undefined);
      const subscribe = vi.fn<Subscribe>(() =>
        setupKind === "asynchronous" ? Promise.resolve(cleanup) : cleanup,
      );
      const { resources, lifecycle } = prepareResources({
        source: sourceDefinition(subscribe),
      });
      const source = resources.get("source")!;
      const first = vi.fn();
      const second = vi.fn();

      const disposeFirst = await source.subscribe({ value: 1 }, first);
      const disposeSecond = await source.subscribe({ value: 1 }, second);

      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
      await disposeFirst();
      expect(subscribe.mock.calls[0]![2].signal.aborted).toBe(true);
      first.mockClear();
      second.mockClear();
      subscribe.mock.calls[0]![1]();
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();
      await disposeFirst();
      await disposeSecond();
      await lifecycle.dispose();
      expect(cleanup).toHaveBeenCalledTimes(2);
    },
  );

  testCases.each(["unsubscribe", "shutdown"] as const)(
    "cancels pending setup on %s without waiting, then releases late cleanup",
    async (ending) => {
      const setup = deferred<RuntimeDisposer>();
      const subscribe = vi.fn<Subscribe>(() => setup.promise);
      const cleanup = vi.fn(async () => undefined);
      const { resources, lifecycle } = prepareResources({
        source: sourceDefinition(subscribe),
      });
      const controller = new AbortController();
      const listener = vi.fn();
      const pending = resources
        .get("source")!
        .subscribe({ value: 1 }, listener, controller.signal);
      const context = subscribe.mock.calls[0]![2];

      if (ending === "shutdown") {
        await lifecycle.dispose();
      } else {
        controller.abort();
      }

      expect(context.signal.aborted).toBe(true);
      setup.resolve(cleanup);
      await expect(pending).rejects.toBe(context.signal.reason);
      subscribe.mock.calls[0]![1]();
      expect(listener).not.toHaveBeenCalled();
      await lifecycle.dispose();
      expect(cleanup).toHaveBeenCalledOnce();
    },
  );

  it("handles synchronous invalidation that cancels before setup returns cleanup", async () => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    const { resources, lifecycle } = prepareResources({
      source: sourceDefinition((_input, invalidate) => {
        invalidate();
        return cleanup;
      }),
    });

    await expect(
      resources
        .get("source")!
        .subscribe({ value: 1 }, () => controller.abort(), controller.signal),
    ).rejects.toBe(controller.signal.reason);

    expect(cleanup).toHaveBeenCalledOnce();
    await lifecycle.dispose();
  });

  it("keeps late cleanup rejection observable after cancellation", async () => {
    const setup = deferred<RuntimeDisposer>();
    const failure = new Error("late cleanup failed");
    const { resources, lifecycle } = prepareResources({
      source: sourceDefinition(() => setup.promise),
    });
    const controller = new AbortController();
    const pending = resources
      .get("source")!
      .subscribe({ value: 1 }, vi.fn(), controller.signal);
    controller.abort();

    setup.resolve(() => {
      throw failure;
    });

    await expect(pending).rejects.toBe(failure);
    await lifecycle.dispose();
  });

  it("awaits and deduplicates derived dependencies before refreshing", async () => {
    const setup = deferred<RuntimeDisposer>();
    const cleanup = vi.fn();
    const subscribe = vi.fn<Subscribe>(() => setup.promise);
    const { resources, lifecycle } = prepareResources({
      source: sourceDefinition(subscribe),
      branch: {
        contract: countContract,
        kind: "derived",
        dependencies: { source: "source" },
        combine: ({ source }) => source,
      },
      derived: {
        contract: doubledContract,
        kind: "derived",
        dependencies: { first: "source", second: "branch" },
        combine: ({ first, second }) => ({
          doubled: first.count + second.count,
        }),
      },
    });
    const listener = vi.fn();
    const pending = resources.get("derived")!.subscribe({ value: 1 }, listener);
    expect(listener).not.toHaveBeenCalled();

    setup.resolve(cleanup);
    const dispose = await pending;

    expect(subscribe).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    await dispose();
    await lifecycle.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rolls back earlier dependencies and reports setup and cleanup failures", async () => {
    const setupFailure = new Error("setup failed");
    const cleanupFailure = new Error("cleanup failed");
    const cleanup = vi.fn(() => {
      throw cleanupFailure;
    });
    const firstSetup = deferred<RuntimeDisposer>();
    const first = vi.fn<Subscribe>(() => firstSetup.promise);
    const second = vi.fn<Subscribe>(async () => {
      throw setupFailure;
    });
    const { resources, lifecycle } = prepareResources({
      first: sourceDefinition(first),
      second: sourceDefinition(second),
      derived: {
        contract: doubledContract,
        kind: "derived",
        dependencies: { first: "first", second: "second" },
        combine: () => ({ doubled: 0 }),
      },
    });
    const listener = vi.fn();

    const pending = resources.get("derived")!.subscribe({ value: 1 }, listener);
    expect(second).not.toHaveBeenCalled();
    firstSetup.resolve(cleanup);

    await expect(pending).rejects.toMatchObject({
      errors: [setupFailure, { errors: [cleanupFailure] }],
    });

    resources.invalidate("first");
    expect(listener).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    await lifecycle.dispose();
  });

  testCases.each(["missing", "", "toString", "constructor", "__proto__"])(
    "rejects unknown resource ID %j",
    async (resourceId) => {
      const lifecycle = createRuntimeLifecycle();
      const resources = createRuntimeResources({
        definitions: {},
        instance: createRuntimeInstance("test").context,
        lifecycle,
      });

      expect(() => resources.invalidate(resourceId)).toThrow(
        `Unknown resource ID: ${resourceId}`,
      );
      await lifecycle.dispose();
    },
  );
});
